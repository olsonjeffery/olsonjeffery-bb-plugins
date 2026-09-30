// Pure pending-tool-call bookkeeping for Thread Cop. No I/O here: server.ts
// feeds this module from the thread event log and the background sweep.

export interface PendingToolCallEntry {
  threadId: string;
  itemId: string;
  /** First-seen tool name: `tool` for toolCall items, the command for commandExecution items. */
  tool: string;
  startedAt: number;
  /** Timestamp of the latest progress heartbeat for this call, when one arrived. */
  lastProgressAt: number | null;
  /** Epoch ms of each delivered nudge, oldest first. */
  nudgedAt: number[];
}

export interface ToolCallStart {
  itemId: string;
  tool: string;
  startedAt: number;
  progressAt?: number;
}

function findEntry(
  entries: PendingToolCallEntry[],
  threadId: string,
  itemId: string,
): PendingToolCallEntry | undefined {
  return entries.find((e) => e.threadId === threadId && e.itemId === itemId);
}

/** Register a pending tool call. Idempotent on itemId: first-seen data wins, earliest startedAt is kept. */
export function registerToolStart(
  entries: PendingToolCallEntry[],
  threadId: string,
  start: ToolCallStart,
): void {
  const existing = findEntry(entries, threadId, start.itemId);
  if (existing) {
    existing.startedAt = Math.min(existing.startedAt, start.startedAt);
    return;
  }
  entries.push({
    threadId,
    itemId: start.itemId,
    tool: start.tool,
    startedAt: start.startedAt,
    lastProgressAt: start.progressAt ?? null,
    nudgedAt: [],
  });
}

/** Record a progress heartbeat. Updates only the matching entry's lastProgressAt. */
export function registerToolProgress(
  entries: PendingToolCallEntry[],
  threadId: string,
  itemId: string,
  progressAt: number,
): void {
  const entry = findEntry(entries, threadId, itemId);
  if (!entry) return;
  if (entry.lastProgressAt === null || progressAt > entry.lastProgressAt) {
    entry.lastProgressAt = progressAt;
  }
}

/** Remove a pending call. Any end status (completed/failed/interrupted) ends it; unknown ids are a no-op. */
export function registerToolEnd(
  entries: PendingToolCallEntry[],
  threadId: string,
  itemId: string,
): void {
  const index = entries.findIndex((e) => e.threadId === threadId && e.itemId === itemId);
  if (index !== -1) entries.splice(index, 1);
}

/** Drop every pending entry for a thread (turn completed / thread drained). */
export function clearThread(entries: PendingToolCallEntry[], threadId: string): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].threadId === threadId) entries.splice(i, 1);
  }
}

/** The heartbeat the hang clock is keyed to: the later of start and last progress. */
export function lastActivityAt(entry: PendingToolCallEntry): number {
  return Math.max(entry.startedAt, entry.lastProgressAt ?? 0);
}

/** Entries whose hang clock has outlasted the timeout (strictly greater than). */
export function dueToolCalls(
  entries: PendingToolCallEntry[],
  nowMs: number,
  timeoutMs: number,
): PendingToolCallEntry[] {
  return entries.filter((entry) => nowMs - lastActivityAt(entry) > timeoutMs);
}

/**
 * Nudge pacing: at most `maxNudges` per call, and a re-nudge only after
 * another full timeout window past the previous nudge (strictly greater than).
 */
export function shouldNudge(
  entry: PendingToolCallEntry,
  nowMs: number,
  timeoutMs: number,
  maxNudges = 3,
): boolean {
  if (entry.nudgedAt.length >= maxNudges) return false;
  const last = entry.nudgedAt[entry.nudgedAt.length - 1];
  if (last === undefined) return true;
  return nowMs - last > timeoutMs;
}
