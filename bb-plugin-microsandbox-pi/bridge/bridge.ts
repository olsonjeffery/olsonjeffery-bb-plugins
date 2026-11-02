// bb-plugin-microsandbox-pi — the provider bridge.
//
// The bb daemon keeps ONE bridge child alive for this provider (all
// sessions multiplex) and drives it with the Provider Bridge Protocol
// over stdio. Two-hop design:
//
//   runtime ⇄ [this bridge: peek, route, buffer] ⇄ per-session relay
//   ⇄ msb box (vsock) ⇄ bb's provider-pi artifact in-box (pi --mode rpc)
//
// Why bb's own provider-pi artifact in-box: it carries the whole
// pi↔bb dialect (sessions, tools, approvals, deltas) for the running
// daemon's protocol version, and spawns pi itself inside the box.
//
// Sessionless lanes:
//   initialize / model/list / skills/configure → the meta child inside
//   a workspace-free meta box (`bbp-meta`).
//   provider/… maintenance requests → answered right here by probing
//   the host binaries (msb, pi).
//
// Everything else is routed on `params.providerThreadId ?? params.threadId`
// to that session's relay; lines arriving before a relay exists are
// buffered and flushed in order once it does.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { experimental_defineProviderBridge, createBridgeIo } from "@get-bb/plugin-sdk/provider-bridge";
import { collectSnapshot, realRunner, sortVersionsDesc } from "../probe";
import { RUNNER_PY } from "./runnerpy";
import { ensureBox, removeBox, type BoxHandle } from "./boxes";
import { bbDataRoot, locateBridgeBundle, locateMsbBin } from "./msbbin";
import { metaBoxName, metaSocketsDir, parseBridgeOptions, threadSocketsDir, loadBridgeOptions, type BridgeOptions } from "./options";
import { realMsbExec } from "./msbexec";
import { startRelay, type Relay } from "./relay";

interface RelayEntry {
  relay?: Relay;
  box?: BoxHandle | null;
  ensure: Promise<Relay>;
  error?: string;
}

interface BridgeState {
  pluginId: string;
  dataDir: string;
  assetsDir: string;
  runnerPy: string;
  options: BridgeOptions;
  env: NodeJS.ProcessEnv;
  io: ReturnType<typeof createBridgeIo>;
  relays: Map<string, RelayEntry>;
  /** providerThreadId → relay key (the threadId the box booted under). */
  alias: Map<string, string>;
  meta: RelayEntry | null;
  msbBin: string | null;
  bridgeBundle: string | null;
  workerPath: string | null;
  binBoot: Promise<void> | null;
  journalPath: string | null;
  journalBytes: number;
  bbRoot: string;
  started: boolean;
  dead: boolean;
}

let state: BridgeState | null = null;

function journal(dir: "in" | "out" | "lane" | "note", line: string): void {
  if (state === null || state.journalPath === null || state.journalBytes > 1_500_000) return;
  try {
    const text = `${Date.now()} ${dir} ${line.slice(0, 300).replace(/\n/g, " ")}\n`;
    appendFileSync(state.journalPath, text);
    state.journalBytes += text.length;
  } catch {
    /* diagnostics must never break the bridge */
  }
}

function out(line: string): void {
  if (state === null || state.dead) return;
  journal("out", line);
  process.stdout.write(`${line}\n`);
}

function failSession(line: string, id: unknown, message: string): void {
  // Reply in JSON-RPC error shape; the runtime surfaces restart hints.
  // Notifications (no id) get no reply — the runtime would drop it anyway.
  if (id === undefined) return;
  const reply = {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
      data: { recovery: { kind: "restartRecommended", message: "Retry after the msb box recovers; the session file persists.", retryable: true } },
    },
  };
  out(JSON.stringify(reply));
}

function peekLine(line: string): { id?: unknown; method?: string; params?: Record<string, unknown>; threadKey: string | null } {
  try {
    const parsed = JSON.parse(line) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { threadKey: null };
    }
    const params = (parsed.params ?? null) as Record<string, unknown> | null;
    const key =
      params !== null && typeof params === "object"
        ? ((params.providerThreadId as string | undefined) ?? (params.threadId as string | undefined) ?? null)
        : null;
    return { id: parsed.id, method: typeof parsed.method === "string" ? parsed.method : undefined, params: params ?? undefined, threadKey: key };
  } catch {
    return { threadKey: null };
  }
}


/** Session ids stream out (thread/identity and the deltas patten):
 * an in-bound turn may carry EITHER the threadId or the providerThreadId,
 * so both forms alias to the relay the box booted under. */
function registerAlias(state: BridgeState, line: string): void {
  const peek = peekLine(line);
  const threadId = typeof peek.params?.threadId === "string" ? peek.params.threadId : null;
  const providerThreadId = typeof peek.params?.providerThreadId === "string" ? peek.params.providerThreadId : null;
  if (threadId === null && providerThreadId === null) return;
  const source = providerThreadId ?? threadId;
  if (source === null) return;
  const target = state.alias.get(source) ?? threadId ?? source;
  if (threadId !== null) state.alias.set(threadId, target);
  if (providerThreadId !== null) state.alias.set(providerThreadId, target);
}

function coldRelay(state: BridgeState, key: string, args: { threadId: string | null; cwd: string | null; envVars?: Record<string, string> }): RelayEntry {
  const entry: RelayEntry = { ensure: null as unknown as Promise<Relay> };
  entry.ensure = (async (): Promise<Relay> => {
    const assets = {
      assetsDir: state.assetsDir,
      bridgeBundle: state.bridgeBundle as string,
      workerPath: state.workerPath as string,
      runnerPy: state.runnerPy,
      msbBin: state.msbBin as string,
      nodeBin: "node", // the box resolves its own image's node on PATH
      bbRoot: state.bbRoot,
    };
    const socketsDir = args.threadId === null
      ? metaSocketsDir(state.assetsDir)
      : threadSocketsDir(state.assetsDir, args.threadId);
    // Listeners first, box second: the guest shim dials each lane once.
    const relay = await startRelay(
      {
        onLine: (line) => {
          // Session ids stream out (thread/identity and most deltas);
          // both forms of an id must reach the session's relay.
          registerAlias(state, line);
          out(line);
        },
        onErrorText: (text) => {
          if (text.trim() !== "") process.stderr.write(`[in-box ${key}] ${text}\n`);
        },
        onLost: (reason) => {
          process.stderr.write(`[in-box ${key}] relay lost: ${reason}\n`);
          journal("note", `lost ${key}: ${reason}`);
          void relayCleanup(state, key);
        },
        onLaneEvent: (note) => journal("lane", `${key} ${note}`),
      },
      { socketsDir },
      key,
    );
    entry.relay = relay;
    // Meta box: pi's spawn cwd for sessionless ops can be anywhere under
    // HOME, so mount HOME once (sessionless pi has no turn tools); thread
    // boxes keep precise per-thread workspaces.
    const workspaceMount = args.threadId === null
      ? (state.env.HOME ?? homedir())
      : args.cwd ?? null;
    const handle = await ensureBox(realMsbExec, assets, {
      threadId: args.threadId,
      cwd: workspaceMount,
      options: state.options,
      env: { ...state.env, ...args.envVars },
    }, {
      prepareSocketDir: async () => {
        /* sockets dir already prepared by the relay bootstrap */
      },
      skipOwnership: false,
    });
    entry.box = handle;
    return relay;
  })().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    entry.error = message;
    // Drop the entry so a later request starts a genuinely fresh boot
    // (it must not await this one's failure forever).
    state.relays.delete(key);
    if (state.meta === entry) state.meta = null;
    throw cause;
  });
  return entry;
}

async function relayFor(
  state: BridgeState,
  key: string,
  opts: { cwd?: string | null; isMeta?: boolean; envVars?: Record<string, string> },
): Promise<RelayEntry> {
  if (opts.isMeta) {
    // Sessionless ops spawn pi per cwd inside the box; the box mounts the
    // whole HOME once (stable footprint), so every spawn cwd that exists
    // resolves without rebooting the meta box per request.
    if (state.meta === null) {
      state.meta = coldRelay(state, key, { threadId: null, cwd: opts.cwd ?? null });
    }
    await state.meta.ensure;
    if (state.meta.error !== undefined) throw new Error(state.meta.error);
    return state.meta;
  }
  let entry = state.relays.get(key);
  if (entry === undefined) {
    entry = coldRelay(state, key, { threadId: key, cwd: opts.cwd ?? null, envVars: opts.envVars });
    state.relays.set(key, entry);
  }
  // A previous failure deletes the entry from the map; this handle may
  // still be mid-flight. Await then surface the stored error.
  await entry.ensure;
  if (entry.error !== undefined) throw new Error(entry.error);
  return entry;
}

async function relayCleanup(state: BridgeState, key: string): Promise<void> {
  const entry = state.relays.get(key) ?? (key === metaBoxName() ? state.meta : null);
  if (entry === null || entry === undefined) return;
  if (entry.box && state.msbBin) void removeBox(realMsbExec, state.msbBin, entry.box.name);
  await entry.relay?.end().catch(() => undefined);
  state.relays.delete(key);
  if (state.meta === entry) state.meta = null;
}

function ensureStarted(state: BridgeState): void {
  if (state.started) return;
  state.started = true;
  state.assetsDir = state.dataDir;
  mkdirSync(join(state.assetsDir, "boxes"), { recursive: true });
}

/** Binary positions are resolved once; failures leave nulls so each
 * request yields a descriptive routing error instead of an in-flight
 * boot loop. */
function binBootOnce(state: BridgeState): Promise<void> {
  if (state.binBoot === null) {
    state.binBoot = (async () => {
      state.options = await loadBridgeOptions(state.dataDir, state.options);
      if (state.journalPath === null && state.options.journal) {
        state.journalPath = join(state.dataDir, "bridge-journal.jsonl");
      }
      state.msbBin = state.msbBin ?? (await locateMsbBin(state.options.msbDirs, state.env));
      const located = await locateBridgeBundle({ dataDir: state.dataDir, env: state.env });
      state.bridgeBundle = state.bridgeBundle ?? located.bridgeBundle;
      state.workerPath = state.workerPath ?? located.workerPath;
      ensureStarted(state);
      if (state.msbBin === null) throw new Error("msb CLI not found — install microsandbox or set the plugin's extra-path setting");
      if (state.bridgeBundle === null) throw new Error("bb provider-pi artifact not found — run the bb daemon once so plugin-host-artifacts exists");
      if (state.workerPath === null) throw new Error("bb bridge worker not found — this bridge child must be spawned by bb's bb-provider-bridge-worker");
    })();
  }
  return state.binBoot;
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  start({ pluginId, dataDir }) {
    const options = parseBridgeOptions("{}");
    const wantJournal = (process.env.MSP_JOURNAL?.trim() ?? "") !== "";
    const runnerPy = join(dataDir, "msb-runner.py");
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(runnerPy, RUNNER_PY, { mode: 0o755 });
      process.stderr.write(`[msp-bridge] started for ${pluginId}\n`);
    } catch (cause) {
      process.stderr.write(`[msp-bridge] start failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    }
    state = {
      pluginId,
      dataDir,
      assetsDir: dataDir,
      runnerPy,
      options,
      env: process.env,
      io: createBridgeIo(),
      relays: new Map(),
      alias: new Map(),
      meta: null,
      msbBin: null,
      bridgeBundle: null,
      workerPath: null,
      binBoot: null,
      journalPath: wantJournal ? join(dataDir, "bridge-journal.jsonl") : null,
      journalBytes: 0,
      bbRoot: "",
      started: false,
      dead: false,
    };
  },
  handleLine(line) {
    const s = state;
    if (s === null) return;
    journal("in", line);
    const peek = peekLine(line);
    const method = peek.method ?? "";

    if (method.startsWith("provider/")) {
      // Sessionless plugin-maintenance requests stay host-side.
      void providerLane(s, peek.id, method, peek.params ?? {});
      return;
    }

    const sessionLane =
      method === "thread/start" || method === "thread/resume" || method === "thread/fork" ||
      method === "turn/start" || method === "turn/steer" || method === "thread/stop";
    // Session-bound lines route on the relay the thread's box was booted
    // under (resolve providerThreadIds through the alias map); anything
    // else is meta-box work.
    let relayKey = "meta";
    if (sessionLane && peek.threadKey !== null) {
      relayKey = s.alias.get(peek.threadKey) ?? peek.threadKey;
    } else if (sessionLane && peek.threadKey === null) {
      relayKey = `proc-${method}`;
    }

    const envVars = envVarsFromParams(peek.params);
    void binBootOnce(s)
      .then(async () => {
        s.bbRoot = s.bbRoot === "" ? await bbDataRoot(s.dataDir) : s.bbRoot;
        const entry =
          sessionLane
            ? await relayFor(s, relayKey, { cwd: (peek.params?.cwd as string | undefined) ?? null, envVars })
            : await relayFor(s, "meta", { isMeta: true, cwd: (peek.params?.cwd as string | undefined) ?? null });
        entry.relay!.writeRuntimeToChild(line);
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        journal("note", `route fail ${method}: ${message}`);
        failSession(line, peek.id ?? null, message);
      });
  },
  onClose() {
    if (state === null) return;
    state.dead = true;
    for (const [, entry] of state.relays) {
      void entry.relay?.end().catch(() => undefined);
      if (entry.box && state.msbBin) void removeBox(realMsbExec, state.msbBin, entry.box.name);
    }
    if (state.meta) {
      void state.meta.relay?.end().catch(() => undefined);
      if (state.meta.box && state.msbBin) void removeBox(realMsbExec, state.msbBin, state.meta.box.name);
    }
    state = null;
  },
  onSigterm() {
    if (state !== null && state.msbBin) {
      // Boxes carry an idle timeout; a fast stop keeps the fleet tidy.
      for (const [, entry] of state.relays) if (entry.box) void removeBox(realMsbExec, state.msbBin, entry.box.name);
      if (state.meta?.box) void removeBox(realMsbExec, state.msbBin, state.meta.box.name);
    }
  },
});

/** pi's shell_environment_policy.set.<NAME> env vars ride turn params. */
function envVarsFromParams(params: Record<string, unknown> | undefined): Record<string, string> {
  if (params === undefined || params === null) return {};
  const config = params.config;
  if (config === null || config === undefined || typeof config !== "object" || Array.isArray(config)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    const prefix = "shell_environment_policy.set.";
    if (key.startsWith(prefix) && typeof value === "string") {
      out[key.slice(prefix.length)] = value;
    }
  }
  return out;
}

async function providerLane(state: BridgeState, id: unknown, method: string, params: Record<string, unknown>): Promise<void> {
  try {
    if (method !== "provider/health") {
      state.io.sendResult(id as never, { supported: false });
      return;
    }
    const snapshot = await collectSnapshot(
      { extraMsbPaths: state.options.msbDirs, piManagedRoot: state.options.piManagedRoot },
      { runner: realRunner, pathEnv: process.env.PATH, home: process.env.HOME ?? tmpdir(), managedRootEnv: process.env.PI_MANAGED_INSTALL_ROOT },
    );
    const msbOk = snapshot.msb.version !== null;
    const piVersions = sortVersionsDesc(snapshot.pi.installedVersions ?? (snapshot.pi.version ? [snapshot.pi.version] : []));
    if (!msbOk && piVersions.length === 0) {
      state.io.sendResult(id as never, {
        supported: true,
        health: {
          status: "not_installed",
          installedVersion: null,
          loginCommand: null,
          accountEmail: null,
          canInstall: false,
          canUpdate: false,
          minimumSupportedVersion: null,
          planLabel: null,
          statusMessage: "Neither the msb CLI (microsandbox) nor the pi agent is installed on this machine.",
        },
      });
      return;
    }
    if (!msbOk) {
      state.io.sendResult(id as never, {
        supported: true,
        health: {
          status: "not_installed",
          installedVersion: piVersions[0] ?? null,
          loginCommand: null,
          accountEmail: null,
          canInstall: false,
          canUpdate: false,
          minimumSupportedVersion: null,
          planLabel: null,
          statusMessage: "The pi agent is installed but the msb CLI (microsandbox) is not — sandboxing is unavailable on this machine.",
        },
      });
      return;
    }
    state.io.sendResult(id as never, {
      supported: true,
      health: {
        status: piVersions.length === 0 ? "not_installed" : "ready",
        installedVersion: piVersions[0] ?? null,
        loginCommand: null,
        accountEmail: null,
        canInstall: false,
        canUpdate: false,
        minimumSupportedVersion: null,
        planLabel: null,
        statusMessage: `msb ${snapshot.msb.version}${piVersions.length > 0 ? ` · pi ${piVersions[0]}` : " · pi missing"}`,
      },
    });
  } catch (cause) {
    state.io.sendError(id as never, -32000, cause instanceof Error ? cause.message : String(cause));
  }
}

export { state as bridgeState };
