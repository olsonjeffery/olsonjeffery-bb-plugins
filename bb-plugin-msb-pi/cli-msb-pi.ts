// bb-plugin-msb-pi — agent-facing CLI (`bb msb-pi …`).
//
// All three subcommands read or force the same monitor state the page
// shows; nothing here probes directly. Rendering treats absence as a
// fact, not an error: a machine without msb prints "not found".
import { PluginCliError, cliCommand, defineCli, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import { formatAgo } from "./lib/ago";
import { HISTORY_CAP, type HistoryEntry, type MachineState, type ToolStatus, type WatchOutput } from "./snapshot";

export interface MsbPiBackend {
  /** Current state with the machine list synced from bb. */
  read(): Promise<WatchOutput>;
  /** Probe now (all machines, or the given ids) and persist results. */
  refresh(hostIds?: string[]): Promise<{ triggered: string[]; failed: string[]; missing: string[] }>;
}

export type RefreshReport = Awaited<ReturnType<MsbPiBackend["refresh"]>>;

/** Machine lookup: exact host id, host-id prefix, or (case-insensitive)
 * host-name prefix. */
export function findMachines(machines: readonly MachineState[], ref: string): MachineState[] {
  const needle = ref.trim().toLowerCase();
  if (!needle) return [];
  return machines.filter(
    (machine) =>
      machine.hostId.toLowerCase().startsWith(needle) ||
      machine.hostName.toLowerCase().startsWith(needle),
  );
}

/** The CLI's one-pass flow: resolve --machine against the stored state,
 * optionally refresh (the requested subset or everything), and re-read. */
export async function gatherState(
  backend: MsbPiBackend,
  machineRef: string | undefined,
  refreshFirst: boolean,
): Promise<{ state: WatchOutput; refreshed: RefreshReport | null }> {
  const ref = machineRef?.trim() ?? "";
  let ids: string[] | null = null;

  if (ref !== "") {
    const initial = await backend.read();
    const hits = findMachines(initial.machines, ref);
    if (hits.length === 0) {
      const names = initial.machines.map((machine) => machine.hostName);
      throw new PluginCliError(`no machine matches "${ref}"`, {
        code: "not_found",
        hint: names.length > 0 ? `Known machines: ${names.join(", ")}.` : "No machines are enrolled with this bb server yet.",
      });
    }
    ids = hits.map((machine) => machine.hostId);
  }

  const refreshed = refreshFirst ? await backend.refresh(ids ?? undefined) : null;
  if (!refreshed && ids === null) return { state: await backend.read(), refreshed: null };

  // Refresh and/or a machine filter: read once more, then narrow.
  const state = await backend.read();
  if (ids !== null) {
    const wanted = new Set(ids);
    return {
      state: {
        generatedAt: state.generatedAt,
        machines: state.machines.filter((machine) => wanted.has(machine.hostId)),
        history: state.history.filter((entry) => wanted.has(entry.hostId)),
      },
      refreshed,
    };
  }
  return { state, refreshed };
}

/** Plain-text rendering tuned for both a terminal and an agent reading
 * tool output: one header line per machine, two tool lines each. */
export function renderWatch(
  state: WatchOutput,
  opts: { now?: number; refreshed?: RefreshReport | null } = {},
): string {
  const now = opts.now ?? Date.now();
  const lines: string[] = [];
  const refreshed = opts.refreshed;
  const suffix = refreshed
    ? ` · refreshed ${refreshed.triggered.length} machine(s)` +
      (refreshed.failed.length > 0 ? `, ${refreshed.failed.length} failed` : "") +
      (refreshed.missing.length > 0 ? `, ${refreshed.missing.length} unknown` : "")
    : "";
  lines.push(`${state.machines.length} machine(s)${suffix}`);
  for (const machine of state.machines) {
    lines.push(...renderMachine(machine, now));
  }
  return lines.join("\n");
}

export function renderMachine(machine: MachineState, now: number): string[] {
  const lines: string[] = [];
  const connection = machine.connected ? "connected" : "disconnected";
  const checked = machine.snapshot
    ? `checked ${formatAgo(machine.snapshot.checkedAt, now)}`
    : "no probe yet (`bb msb-pi refresh`)";
  const error = machine.lastError ? ` · error: ${machine.lastError}` : "";
  lines.push(
    `${machine.hostName} — ${connection} · ${machine.snapshot?.platform ?? "—"} · ${checked}${error}`,
  );
  lines.push(...renderTool("pi ", machine.snapshot?.pi ?? null));
  lines.push(...renderTool("msb", machine.snapshot?.msb ?? null));
  return lines;
}

export function renderTool(label: "pi " | "msb", status: ToolStatus | null): string[] {
  const parts: string[] = [];
  if (status?.version) parts.push(status.version);
  else if (status?.error) parts.push("probe failed");
  else parts.push("not found");
  if (status?.origin) parts.push(status.origin);
  const head = `  ${label}  ${parts.join(" · ")}`;
  const tail: string[] = [];
  if (status?.path) tail.push(status.path);
  if (status?.detail) tail.push(status.detail);
  if (status?.installedVersions && status.installedVersions.length > 1) {
    tail.push(`releases: ${status.installedVersions.join(", ")}`);
  }
  if (status?.error) tail.push(`error: ${status.error}`);
  const lines = [head];
  for (const segment of tail) lines.push(`         ${segment}`);
  return lines;
}

export function renderHistory(
  entries: readonly HistoryEntry[],
  limit: number,
  now: number = Date.now(),
): string {
  const slice = entries.slice(0, Math.max(1, Math.min(limit, HISTORY_CAP)));
  const head =
    entries.length === 0
      ? "Version history — no changes recorded yet"
      : `Version history — ${entries.length} change(s), newest first`;
  const lines = [head];
  for (const entry of slice) {
    lines.push(`  ${entry.tool} ${describeTransition(entry)}   ${entry.hostName} · ${formatAgo(entry.at, now)}`);
  }
  return lines.join("\n");
}

function describeTransition(entry: HistoryEntry): string {
  if (entry.kind === "added") return `appeared at ${entry.to}`;
  if (entry.kind === "removed") return `${entry.from} now missing`;
  return `${entry.from} → ${entry.to}`;
}

export function buildMsbPiCli(backend: MsbPiBackend): PluginCliRegistration {
  return defineCli({
    name: "msb-pi",
    summary: "Installed versions of msb (microsandbox) and the pi coding agent, per machine",
    description:
      "Reads the monitor state the MSB + pi plugin keeps; add --refresh to probe before printing. Probes only run `--version` locally on each machine.",
    commands: {
      versions: cliCommand({
        summary: "Print the installed msb and pi versions per machine",
        options: {
          machine: { type: "string", description: "Only this machine (host id or name prefix)" },
          refresh: { type: "boolean", description: "Probe before printing instead of showing the last result" },
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          const gather = await gatherState(backend, input.options.machine, input.options.refresh);
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ ...gather.state, refreshed: gather.refreshed }, null, 2) };
          }
          return { exitCode: 0, stdout: renderWatch(gather.state, { refreshed: gather.refreshed }) };
        },
      }),
      refresh: cliCommand({
        summary: "Probe every (or one) machine now and store the snapshots",
        options: {
          machine: { type: "string", description: "Only this machine (host id or name prefix)" },
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          const resolvedIds = input.options.machine ? (await gatherState(backend, input.options.machine, false)).state.machines.map((m) => m.hostId) : undefined;
          const refreshed = await backend.refresh(resolvedIds);
          const state = await gatherState(backend, input.options.machine, false).then((gather) => gather.state);
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ ...state, refreshed }, null, 2) };
          }
          return { exitCode: 0, stdout: renderWatch(state, { refreshed }) };
        },
      }),
      history: cliCommand({
        summary: "Print recorded msb/pi version changes, newest first",
        options: {
          machine: { type: "string", description: "Only this machine (host id or name prefix)" },
          limit: { type: "integer", min: 1, max: HISTORY_CAP, default: 25, description: `Up to ${HISTORY_CAP} most recent entries` },
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          const machineRef = typeof input.options.machine === "string" ? input.options.machine : undefined;
          const { state } = await gatherState(backend, machineRef, false);
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ history: state.history }, null, 2) };
          }
          return { exitCode: 0, stdout: renderHistory(state.history, input.options.limit) };
        },
      }),
    },
  });
}
