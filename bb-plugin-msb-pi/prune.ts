// bb-plugin-msb-pi — history retention.
//
// A version watcher's log grows one row per change; without shaping it
// becomes 4am noise. Policy: everything from the last 24h stays, older
// entries collapse to the newest change per machine per tool per
// calendar day (UTC), and the whole log stays capped at 200 (newest
// first, so the cap can only drop the oldest daily buckets). Pure and
// tested; called on every history write.
import { HISTORY_CAP, type HistoryEntry } from "./snapshot";

export const HISTORY_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PruneOptions {
  now: number;
  recentWindowMs?: number;
  totalCap?: number;
}

export function pruneHistory(entries: readonly HistoryEntry[], options: PruneOptions): HistoryEntry[] {
  const now = options.now;
  const recentWindowMs = options.recentWindowMs ?? HISTORY_RECENT_WINDOW_MS;
  const totalCap = options.totalCap ?? HISTORY_CAP;

  const recent: HistoryEntry[] = [];
  const consolidated = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (now - entry.at < recentWindowMs) {
      recent.push(entry);
    } else if (!consolidated.has(dayBucketKey(entry))) {
      // Entries arrive newest-first, so the first hit per bucket is
      // that bucket's newest change — exactly what day granularity keeps.
      consolidated.set(dayBucketKey(entry), entry);
    }
  }
  const older = [...consolidated.values()].sort((a, b) => b.at - a.at);
  return [...recent, ...older].slice(0, totalCap);
}

function dayBucketKey(entry: HistoryEntry): string {
  return `${entry.hostId}|${entry.tool}|${new Date(entry.at).toISOString().slice(0, 10)}`;
}
