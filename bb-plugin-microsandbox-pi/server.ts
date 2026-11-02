// bb-plugin-microsandbox-pi — server entry.
//
// Watches every enrolled machine for installed versions of the
// microsandbox CLI (`msb`) and the pi coding agent (`pi`):
//
//   - bb.host artifact answers per machine (probe.ts, `--version` runs
//     and filesystem reads only);
//   - this entry keeps one snapshot per host in kv storage, records
//     version changes in a capped history, and pushes a realtime ping
//     after every cycle;
//   - the nav panel page and `bb microsandbox-pi` CLI read the same state.
//
// Cycles serialize behind a small mutex so concurrent refreshes (page
// + CLI + timer) can't interleave read-modify-write or double-record
// a transition.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { buildMsbPiCli, gatherState, renderHistory, renderWatch, renderBoxes, type MsbPiBackend } from "./cli-microsandbox-pi";
import { hostContract } from "./host-contract";
import { rpcContract, REALTIME_CHANNEL } from "./contract";
import { loadMonitorState, saveMonitorState, withHistory, type MonitorState } from "./store";
import {
  applyNpmResult,
  dueForRefetch,
  loadNpmLatest,
  packageNamesOf,
  parseDistTags,
  projectNpmLatest,
  saveNpmLatest,
  NPM_FETCH_TIMEOUT_MS,
  type NpmLatestCache,
} from "./npm-latest";
import { pruneHistory } from "./prune";
import {
  type HistoryEntry,
  type MachineSnapshot,
  type MachineState,
  type SnapshotArgs,
  type WatchOutput,
} from "./snapshot";
import { diffSnapshots } from "./diff";

type HostRow = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];

/** The provider bridge's option envelope: one JSON env var per spawn. */
function parseMountLines(value: string): { src: string; dest: string; ro: boolean }[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [src, dest, mode] = line.split(":");
      if (!src || !dest) return null;
      return { src: src.trim(), dest: dest.trim(), ro: mode === "ro" };
    })
    .filter((row): row is { src: string; dest: string; ro: boolean } => row !== null);
}

function parseSecretLines(value: string): { env: string; hosts: string[] }[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ""
    )
    .flatMap((line) => {
      const at = line.indexOf("@");
      if (at <= 0) return [];
      const env = line.slice(0, at).trim();
      const hosts = line.slice(at + 1).split(",").map((h) => h.trim()).filter(Boolean);
      return hosts.length > 0 ? [{ env, hosts }] : [];
    });
}

interface ProbeReport {
  triggered: string[];
  failed: string[];
  missing: string[];
}

const NPM_FETCH_BUDGET_PER_CYCLE = 4; // bound cycles to four registry hits

interface ProbeOutcome {
  hostId: string;
  connected: boolean;
  snapshot: MachineSnapshot | null;
  error: string | null;
}

const PROBE_TIMEOUT_MS = 30_000;

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    intervalMinutes: {
      type: "number",
      label: "Check interval (minutes)",
      description:
        "How often each machine is re-probed in the background. You can always force a cycle from the page or `bb microsandbox-pi refresh`.",
      default: 15,
      experimental_schema: z.number().int().min(1).max(720),
    },
    extraMsbPaths: {
      type: "string",
      label: "Extra msb paths",
      description: `Directories that also get checked for the msb binary, one per line (or full paths ending in "msb"). Handy for npm-local installs like ~/path/node_modules/.bin.`,
      default: "",
      experimental_multiline: true,
    },
    piManagedRoot: {
      type: "string",
      label: "pi managed-install root",
      description: "Override for ~/.pi/agent/install (or PI_MANAGED_INSTALL_ROOT) when checking for installed pi releases. Leave empty for auto-detect.",
      default: "",
    },
    boxImage: {
      type: "string",
      label: "Sandbox image",
      description: "OCI image the sandboxed pi box boots from (needs node). Default node:22-bookworm; pulled once, then boots cold in ~0.4s.",
      default: "node:22-bookworm",
    },
    boxCpus: {
      type: "string",
      label: "Sandbox CPUs",
      description: "vCPU count per box (msb -c). Default 2.",
      default: "2",
    },
    boxMemory: {
      type: "string",
      label: "Sandbox memory",
      description: "Memory per box (msb -m). Default 2G.",
      default: "2G",
    },
    idleStopMinutes: {
      type: "number",
      label: "Sandbox idle stop (minutes)",
      description: "Per-thread boxes stop themselves after this idle period; sessions revive from the host-bound session file on the next resume.",
      default: 30,
      experimental_schema: z.number().int().min(1).max(720),
    },
    piHomeMount: {
      type: "boolean",
      label: "Mount ~/.pi/agent in-box (read-write)",
      description:
        "Inside the box, pi joins the host's agent dir read-write (skills, settings and stored logins). Turn off for strict secret-substitution-only auth — pi then has no skills and no stored credentials in-box.",
      default: true,
    },
    extraMounts: {
      type: "string",
      label: "Extra box mounts",
      description: 'One per line: SRC:DEST[:ro]. Binds additional host directories into every box (skills roots, scratch). "~" expands.',
      default: "",
      experimental_multiline: true,
    },
    secretRoutes: {
      type: "string",
      label: "Secret routes (msb substitution)",
      description:
        'One per line: ENV@host[,host…]. Keys present in the daemon env never enter the box; msb substitutes them on matching egress. Empty value = the built-in defaults.',
      default: "ANTHROPIC_API_KEY@api.anthropic.com\nOPENAI_API_KEY@api.openai.com\nGEMINI_API_KEY@generativelanguage.googleapis.com\nOPENCODE_API_KEY@opencode.ai\nDEEPSEEK_API_KEY@api.deepseek.com\nCEREBRAS_API_KEY@api.cerebras.ai\nXAI_API_KEY@api.x.ai\nMOONSHOT_API_KEY@api.moonshot.cn\nZAI_API_KEY@api.z.ai",
      experimental_multiline: true,
    },
    tlsIntercept: {
      type: "boolean",
      label: "TLS interception",
      description: "Let msb inspect HTTPS inside the box so secret substitution can gate hosts. Off disables substitution-adjacent gating (secrets then also stop flowing).",
      default: true,
    },
    checkNpm: {
      type: "boolean",
      label: "Check npm for the newest release",
      description:
        "Compare installed versions against the npm registry (dist-tags) for packages the fleet installs. Cached answers refresh every 6 hours; an offline host degrades to a stale note, never an error.",
      default: true,
    },
    bridgeJournal: {
      type: "boolean",
      label: "Journal the sandbox bridge protocol lines",
      description:
        "While on, the provider bridge appends a short per-line record of what it received, sent, and lost in <dataDir>/bridge-data/bridge-journal.jsonl (leaf diagnostics; off by default).",
      default: false,
    },
  });

  const settingsValues = await settings.get();  // refreshed by onChange below
  settings.onChange((next) => {
    Object.assign(settingsValues, next);
    // Extra paths / managed root changed: refresh promptly so the page
    // reflects the new probe arguments instead of waiting a cycle.
    void probeAll({}).catch((cause) => {
      bb.log.warn(`post-settings probe failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  });

  // The bridge child reads its box config from the plugin data dir (the
  // bootstrap passes dataDir; the runtime does not carry plugin options
  // into the child env). Write the file here, refresh it with settings.
  const writeBridgeOpts = async (): Promise<void> => {
    const dataDir = bb.server.experimental_dataDir;
    if (dataDir === null) return;
    const dir = join(dataDir, "plugins", bb.pluginId);
    try {
      await mkdir(join(dir, "boxes"), { recursive: true });
      const values = await settings.get();
      await writeFile(
        join(dir, "bridge-opts.json"),
        JSON.stringify({
          image: values.boxImage,
          idleStopSeconds: values.idleStopMinutes * 60,
          piHomeMount: values.piHomeMount !== false,
          extraMounts: parseMountLines(values.extraMounts),
          secretRoutes: parseSecretLines(values.secretRoutes),
          tlsIntercept: values.tlsIntercept !== false,
          memorySpec: values.boxMemory,
          cpus: values.boxCpus,
          msbDirs: values.extraMsbPaths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          piManagedRoot: values.piManagedRoot,
          journal: values.bridgeJournal === true,
        }),
      );
    } catch (cause) {
      bb.log.warn(`bridge-opts write failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  void writeBridgeOpts();
  settings.onChange(() => void writeBridgeOpts());

  const hostClient = bb.hosts.experimental_client({ contract: hostContract });
  const unsubscribeWorkerExit = hostClient.experimental_onWorkerExit(({ hostId }) => {
    bb.log.warn(`probe worker exited unexpectedly on host ${hostId}`);
  });

  // ------------------------------------------------------------------
  // probe cycle

  let cycleMutex: Promise<unknown> = Promise.resolve();
  function withMutex<T>(work: () => Promise<T>): Promise<T> {
    const acquired = cycleMutex.then(work, work);
    cycleMutex = acquired.then(
      () => undefined,
      () => undefined,
    );
    return acquired;
  }

  async function snapshotArgs(): Promise<SnapshotArgs> {
    const values = await settings.get();
    return {
      extraMsbPaths: values.extraMsbPaths
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
      piManagedRoot: values.piManagedRoot.trim(),
    };
  }

  async function probeOne(host: HostRow, args: SnapshotArgs, signal: AbortSignal | undefined): Promise<ProbeOutcome> {
    if (host.status !== "connected") {
      return {
        hostId: host.id,
        connected: false,
        snapshot: null,
        error: "machine is disconnected",
      };
    }
    try {
      const snapshot = await hostClient.call("snapshot", args, {
        hostId: host.id,
        ...(signal ? { signal } : {}),
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return { hostId: host.id, connected: true, snapshot, error: null };
    } catch (cause) {
      return {
        hostId: host.id,
        connected: host.status === "connected",
        snapshot: null,
        error: cause instanceof Error ? shortError(cause) : String(cause),
      };
    }
  }

  /** One cycle over the connected hosts: probe, merge, diff, save. */
  async function probeAll(opts: { hostIds?: string[]; signal?: AbortSignal } = {}): Promise<ProbeReport> {
    return withMutex(async () => {
      const hostList = await bb.sdk.hosts.list();
      const wanted = opts.hostIds && opts.hostIds.length > 0 ? new Set(opts.hostIds) : null;
      const targets = hostList.filter((host) => wanted === null || wanted.has(host.id));
      const missing = opts.hostIds?.filter((hostId) => !hostList.some((host) => host.id === hostId)) ?? [];

      const args = await snapshotArgs();
      const outcomes = await Promise.all(targets.map((host) => probeOne(host, args, opts.signal)));

      const state = await loadMonitorState(bb);
      const freshChanges: HistoryEntry[] = [];
      let probed = 0;

      for (const outcome of outcomes) {
        const host = hostList.find((row) => row.id === outcome.hostId)!;
        const prev = state.machines.find((machine) => machine.hostId === outcome.hostId);
        const machine = mergeOutcome(host, prev, outcome);
        upsertMachine(state, machine);
        if (outcome.snapshot) {
          const hostName = host.name || machine.hostName;
          freshChanges.push(...diffSnapshots(prev?.snapshot ?? null, outcome.snapshot, { hostId: outcome.hostId, hostName }));
          probed += 1;
        }
      }

      // Hosts not targeted this cycle still refresh their connection
      // facts so the page shows reality after enroll-remove cycles.
      for (const host of hostList) {
        if (!state.machines.some((machine) => machine.hostId === host.id)) {
          upsertMachine(state, mergeOutcome(host, undefined, { hostId: host.id, connected: false, snapshot: null, error: null }));
        }
      }

      state.history = pruneHistory(withHistory(state.history, freshChanges), { now: Date.now() });
      await saveMonitorState(bb, state);

      bb.realtime.publish(REALTIME_CHANNEL, { kind: "probed", probed });

      const failed = outcomes
        .filter((outcome) => outcome.error !== null)
        .map((outcome) => outcome.hostId);
      return {
        triggered: outcomes.filter((outcome) => outcome.snapshot !== null).map((outcome) => outcome.hostId),
        failed,
        missing,
      };
    });
  }

  // ------------------------------------------------------------------
  // npm "latest available" answers, refetched in the background.
  // Runs after (not inside) the cycle's mutex so a slow registry can't
  // block the next probe.

  async function refreshNpmLatest(signal?: AbortSignal): Promise<void> {
    if (!(await settings.get()).checkNpm) return;
    const state = await present();
    const packageNames = packageNamesOf(state.machines.flatMap((machine) => (machine.snapshot ? [machine.snapshot] : [])));
    if (packageNames.length === 0) return;
    const cache = await loadNpmLatest(bb);
    const due = dueForRefetch(cache, packageNames, Date.now()).slice(0, NPM_FETCH_BUDGET_PER_CYCLE);
    let cacheMut = cache;
    let changed = false;
    const now = Date.now();
    for (const packageName of due) {
      const result = await fetchLatestDistTag(packageName, signal);
      const before = cacheMut[packageName];
      cacheMut = applyNpmResult(cacheMut, packageName, result, now);
      if ((before?.version ?? undefined) !== (cacheMut[packageName]?.version ?? undefined)) changed = true;
    }
    if (due.length === 0) return;
    await saveNpmLatest(bb, cacheMut);
    if (changed) bb.realtime.publish(REALTIME_CHANNEL, { kind: "npm" });
  }

  async function fetchLatestDistTag(packageName: string, signal: AbortSignal | undefined): Promise<{ latest: string | null; error: string | null }> {
    const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`;
    const timeout = AbortSignal.timeout(NPM_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { accept: "application/json" },
      });
      if (!response.ok) return { latest: null, error: `registry responded ${response.status}` };
      return parseDistTags(await response.text());
    } catch (cause) {
      return { latest: null, error: cause instanceof Error ? shortError(cause) : String(cause) };
    }
  }

  // ------------------------------------------------------------------
  // present: stored state + live machine list, without persisting

  async function present(): Promise<WatchOutput> {
    const [state, hostList] = await Promise.all([loadMonitorState(bb), bb.sdk.hosts.list()]);
    const machines: MachineState[] = hostList.map((host) => {
      const stored = state.machines.find((machine) => machine.hostId === host.id);
      return withHostFacts(
        stored ?? {
          hostId: host.id,
          hostName: host.name,
          connected: false,
          snapshot: null,
          lastError: null,
          lastErrorAt: null,
        },
        host,
      );
    });
    const npmLatest = (await settings.get()).checkNpm
      ? projectNpmLatest(
          await loadNpmLatest(bb),
          packageNamesOf(machines.flatMap((machine) => (machine.snapshot ? [machine.snapshot] : []))),
        )
      : undefined;
    return { generatedAt: Date.now(), machines, history: state.history, npmLatest };
  }

  function mergeOutcome(host: HostRow, prev: MachineState | undefined, outcome: ProbeOutcome): MachineState {
    const base: MachineState = prev ?? {
      hostId: host.id,
      hostName: host.name,
      connected: host.status === "connected",
      snapshot: null,
      lastError: null,
      lastErrorAt: null,
    };
    return {
      ...base,
      connected: base.connected || outcome.connected,
      snapshot: outcome.snapshot ?? base.snapshot,
      lastError: outcome.error ?? null,
      lastErrorAt: outcome.error ? Date.now() : null,
    };
  }

  function withHostFacts(machine: MachineState, host: HostRow): MachineState {
    return { ...machine, hostName: host.name, connected: host.status === "connected" };
  }

  function upsertMachine(state: MonitorState, machine: MachineState): void {
    const index = state.machines.findIndex((row) => row.hostId === machine.hostId);
    if (index >= 0) state.machines[index] = machine;
    else state.machines.push(machine);
  }

  function shortError(cause: Error): string {
    const text = cause.message.replace(/\s+/g, " ").trim();
    return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
  }

  // ------------------------------------------------------------------
  // provider: pi (microsandbox)

  const providerBridgeOptions = (): string =>
    JSON.stringify({
      image: typeof settingsValues.boxImage === "string" && settingsValues.boxImage ? settingsValues.boxImage : undefined,
      idleStopSeconds: typeof settingsValues.idleStopMinutes === "number" ? settingsValues.idleStopMinutes * 60 : undefined,
      piHomeMount: settingsValues.piHomeMount === false ? false : undefined,
      extraMounts: parseMountLines(settingsValues.extraMounts),
      secretRoutes: parseSecretLines(settingsValues.secretRoutes),
      tlsIntercept: settingsValues.tlsIntercept === false ? false : undefined,
      memorySpec: typeof settingsValues.boxMemory === "string" && settingsValues.boxMemory ? settingsValues.boxMemory : undefined,
      cpus: typeof settingsValues.boxCpus === "string" && settingsValues.boxCpus ? settingsValues.boxCpus : undefined,
    });

  bb.providers.register({
    id: "microsandbox-pi",
    displayName: "pi (microsandbox)",
    family: "pi",
    icon: "./assets/provider-icon.svg",
    strings: {
      signInHint: "pi credentials ride the machine: either the read-only ~/.pi/agent mount or msb secret substitution (Settings -> plugin).",
      expiredHint: "The box stopped: retry the turn - it reboots in under a second and resumes from the host session file.",
      installUrl: "https://github.com/superradcompany/microsandbox",
    },
    experimental_visibility: "always",
    maintenance: { health: true, installation: false, usage: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "max"],
    },
    reasoningLevels: [
      { id: "none", label: "Off" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "max", label: "Max" },
    ],
    composerActions: [],
    models: { fallback: [], scope: "workspace" },
    experimental_bridgeOptions: {
      image: settingsValues.boxImage,
      idleStopSeconds: settingsValues.idleStopMinutes * 60,
      piHomeMount: settingsValues.piHomeMount !== false,
      extraMounts: parseMountLines(settingsValues.extraMounts),
      secretRoutes: parseSecretLines(settingsValues.secretRoutes),
      tlsIntercept: settingsValues.tlsIntercept !== false,
      memorySpec: settingsValues.boxMemory,
      cpus: settingsValues.boxCpus,
      msbDirs: settingsValues.extraMsbPaths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      piManagedRoot: settingsValues.piManagedRoot,
    },
    deriveProviderOptions(context) {
      void context;
      return {
        envVars: {
          ...Object.fromEntries(
            collectSecretNames(settingsValues.secretRoutes)
              .map((name) => [name, process.env[name]])
              .filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim() !== ""),
          ),
        },
      };
    },
  });

  // Credentials for msb substitution ride `deriveProviderOptions` (below)
  // rather than env contributions: the bridge child env does not carry
  // contributed values, but `providerOptions.envVars` arrives in params.

  function collectSecretNames(routes: string): string[] {
    return parseSecretLines(routes).map((route) => route.env);
  }

  async function extraMsbDirs(): Promise<string> {
    const values = await settings.get();
    return values.extraMsbPaths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
  }

  const backend: MsbPiBackend = {
    read: present,
    refresh: async (hostIds) => {
      const report = await probeAll({ hostIds });
      return report;
    },
  };

  bb.rpc.register(rpcContract, {
    watch: () => present(),
    refresh: async (input) => {
      const report = await probeAll({ hostIds: input.hostIds });
      return { triggered: report.triggered, failed: report.failed, missing: report.missing };
    },
  });

  bb.cli.register(buildMsbPiCli(backend));

  bb.background.service("poll", {
    async start(signal) {
      bb.log.info("watch started");
      await cycleLogging(probeAll({ signal }), "initial");
      while (!signal.aborted) {
        await npmLogging(refreshNpmLatest(signal));
        const { intervalMinutes } = await settings.get();
        await sleep(intervalMinutes * 60_000 + Math.floor(Math.random() * 3_000), signal);
        if (signal.aborted) break;
        await cycleLogging(probeAll({ signal }), "scheduled");
      }
    },
  });

  async function cycleLogging(cycle: Promise<ProbeReport>, label: string): Promise<void> {
    try {
      const report = await cycle;
      bb.log.info(
        `${label} cycle done: probed ${report.triggered.length}, failed ${report.failed.length}, missing ${report.missing.length}`,
      );
    } catch (cause) {
      bb.log.error(`${label} cycle failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function npmLogging(step: Promise<void>): Promise<void> {
    try {
      await step;
    } catch (cause) {
      bb.log.warn(`npm check failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  // ------------------------------------------------------------------
  // agent tools: dynamic, schema'd answers for threads — including the
  // in-box view of each machine's msb runtime.

  bb.agents.registerTool({
    name: "microsandbox_pi_versions",
    description:
      "Installed versions of msb (microsandbox) and the pi coding agent across every enrolled bb machine — the MSB + pi watcher's stored results, with install origins and npm update hints. Use this instead of shelling out to `msb --version`/`pi --version`.",
    presentation: {
      label: { pending: "Checking installed msb/pi versions", completed: "Checked installed msb/pi versions" },
    },
    parameters: z.object({ machine: z.string().optional() }).strict(),
    async execute({ machine }) {
      const { state } = await gatherState(backend, machine, false);
      return renderWatch(state);
    },
  });

  bb.agents.registerTool({
    name: "microsandbox_pi_probe",
    description:
      "Force a fresh probe of installed msb and pi versions right now (defaults to every connected machine; pass a machine id/name to target one). Takes a few seconds.",
    presentation: {
      label: { pending: "Probing installed msb/pi versions", completed: "Probed installed msb/pi versions" },
    },
    parameters: z.object({ machine: z.string().optional() }).strict(),
    async execute({ machine }) {
      const resolvedIds = machine
        ? (await gatherState(backend, machine, false)).state.machines.map((row) => row.hostId)
        : undefined;
      await backend.refresh(resolvedIds);
      const { state } = await gatherState(backend, machine, false);
      return renderWatch(state);
    },
  });

  bb.agents.registerTool({
    name: "microsandbox_pi_boxes",
    description:
      "The in-box view: which sandboxes exist in each machine's msb runtime (name, image, state), straight from `msb list` at the last probe. Machines without msb report none.",
    presentation: {
      label: { pending: "Listing msb runtime sandboxes", completed: "Listed msb runtime sandboxes" },
    },
    parameters: z.object({ machine: z.string().optional() }).strict(),
    async execute({ machine }) {
      const { state } = await gatherState(backend, machine, false);
      return (
        renderBoxes(state.machines) ||
        "No msb runtime found on any machine — nothing to list."
      );
    },
  });

  bb.agents.registerTool({
    name: "microsandbox_pi_history",
    description:
      "Version changes the MSB + pi watcher has recorded (newest first): when msb/pi appeared, changed or vanished on each machine.",
    presentation: {
      label: { pending: "Reading version-change history", completed: "Read version-change history" },
    },
    parameters: z.object({ machine: z.string().optional() }).strict(),
    async execute({ machine }) {
      const { state } = await gatherState(backend, machine, false);
      return renderHistory(state.history, 50);
    },
  });

  bb.onDispose(() => {
    unsubscribeWorkerExit();
    bb.log.info("disposed");
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
