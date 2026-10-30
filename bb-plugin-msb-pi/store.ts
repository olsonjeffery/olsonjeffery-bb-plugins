// bb-plugin-msb-pi — durable plugin state.
//
// One kv row keeps everything between probes: the latest snapshot per
// machine plus the version-change history. Small, JSON, capped — the
// 256 KiB kv ceiling gives plenty of headroom at HISTORY_CAP.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { HISTORY_CAP, type HistoryEntry, type MachineState } from "./snapshot";

export interface MonitorState {
  machines: MachineState[];
  history: HistoryEntry[];
}

const STATE_KEY = "state";

export const emptyMonitorState = (): MonitorState => ({ machines: [], history: [] });

export async function loadMonitorState(bb: BbPluginApi): Promise<MonitorState> {
  const row = await bb.storage.kv.get<Record<string, unknown>>(STATE_KEY);
  if (!row || typeof row !== "object" || Array.isArray(row)) return emptyMonitorState();
  const machines = row.machines;
  const history = row.history;
  return {
    machines: Array.isArray(machines) ? (machines as MachineState[]) : [],
    history: sanitizeHistory(history),
  };
}

function sanitizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  // Entries come only from diffSnapshots, but an older bundle or a
  // lucky edit must not crash the page either.
  return value
    .filter(
      (entry): entry is HistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        "tool" in entry &&
        ((entry as HistoryEntry).tool === "pi" || (entry as HistoryEntry).tool === "msb"),
    )
    .slice(0, HISTORY_CAP);
}

export async function saveMonitorState(bb: BbPluginApi, state: MonitorState): Promise<void> {
  await bb.storage.kv.set(STATE_KEY, {
    machines: state.machines,
    history: state.history.slice(0, HISTORY_CAP),
  });
}

/** Append fresh entries ahead of the log, newest first, capped. Exact
 * duplicates (a retried write replaying the same transition) collapse: a
 * genuine flip-back records at a new time and stays. */
export function withHistory(current: HistoryEntry[], additions: HistoryEntry[]): HistoryEntry[] {
  return dedupe([...additions, ...current]).slice(0, HISTORY_CAP);
}

function dedupe(entries: HistoryEntry[]): HistoryEntry[] {
  // Scanning oldest→newest (the array is newest-first, so backwards)
  // and keeping the last occurrence means an exact replay collapses
  // into the recorded entry it duplicated, instead of duplicating a
  // copy at the top of the log.
  const seen = new Set<string>();
  const kept: HistoryEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const fingerprint = [entry.hostId, entry.tool, entry.kind, entry.from, entry.to, entry.at].join(" ");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    kept.push(entry);
  }
  return kept.reverse();
}
