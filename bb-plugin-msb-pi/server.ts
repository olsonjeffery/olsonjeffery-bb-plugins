// bb-plugin-msb-pi — server entry.
//
// Watches every enrolled machine for installed versions of the
// microsandbox CLI (`msb`) and the pi coding agent (`pi`):
//
//   - bb.host artifact answers per machine (probe.ts, `--version` runs
//     and filesystem reads only);
//   - this entry keeps one snapshot per host in kv storage, records
//     version changes in a capped history, and pushes a realtime ping
//     after every cycle;
//   - the nav panel page and `bb msb-pi` CLI read the same state.
//
// Cycles serialize behind a small mutex so concurrent refreshes (page
// + CLI + timer) can't interleave read-modify-write or double-record
// a transition.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { buildMsbPiCli, type MsbPiBackend } from "./cli-msb-pi";
import { hostContract } from "./host-contract";
import { rpcContract, REALTIME_CHANNEL } from "./contract";
import { loadMonitorState, saveMonitorState, withHistory, type MonitorState } from "./store";
import {
  type HistoryEntry,
  type MachineSnapshot,
  type MachineState,
  type SnapshotArgs,
  type WatchOutput,
} from "./snapshot";
import { diffSnapshots } from "./diff";

type HostRow = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];

interface ProbeReport {
  triggered: string[];
  failed: string[];
  missing: string[];
}

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
        "How often each machine is re-probed in the background. You can always force a cycle from the page or `bb msb-pi refresh`.",
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
  });

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

      state.history = withHistory(state.history, freshChanges);
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
    return { generatedAt: Date.now(), machines, history: state.history };
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
  // surfaces

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

  settings.onChange(() => {
    // Extra paths / managed root changed: refresh promptly so the page
    // reflects the new probe arguments instead of waiting a cycle.
    void probeAll({}).catch((cause) => {
      bb.log.warn(`post-settings probe failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
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
