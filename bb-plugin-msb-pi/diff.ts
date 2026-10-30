// bb-plugin-msb-pi — turning snapshots into history.
//
// Pure and small on purpose: given yesterday's snapshot and today's,
// list the version transitions that happened on that machine. The
// caller records order and caps the log.
import { WATCHED_TOOLS, type HistoryEntry, type MachineSnapshot, type WatchedTool } from "./snapshot";

export interface DiffHost {
  hostId: string;
  hostName: string;
}

/** Version changes between two consecutive snapshots of one machine. */
export function diffSnapshots(
  prev: MachineSnapshot | null,
  next: MachineSnapshot,
  host: DiffHost,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const tool of WATCHED_TOOLS) {
    const from = readVersion(prev, tool);
    const to = readVersion(next, tool);
    if (from === to) continue;
    entries.push({
      at: next.checkedAt,
      hostId: host.hostId,
      hostName: host.hostName,
      tool,
      kind: from === null ? "added" : to === null ? "removed" : "changed",
      from,
      to,
    });
  }
  return entries;
}

function readVersion(snapshot: MachineSnapshot | null, tool: WatchedTool): string | null {
  if (snapshot === null) return null;
  const status = snapshot[tool];
  return status?.version ?? null;
}
