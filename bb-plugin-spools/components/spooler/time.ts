/** Time grouping + relative timestamps for the thread list. */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * True while a thread is live: executing, winding down, running background
 * work, holding a queued message, or blocked on the user. Live threads
 * count as active right now for grouping and sorting.
 */
export function isLiveThread(thread: PluginSidebarThread): boolean {
  return (
    isRunningThread(thread) ||
    thread.queuedWork !== "none" ||
    thread.hasPendingInteraction
  );
}

/** Execution and background work, excluding queued or blocked work. */
export function isRunningThread(thread: PluginSidebarThread): boolean {
  if (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  ) {
    return true;
  }
  const activity = thread.activity;
  if (
    activity.workflows +
      activity.backgroundAgents +
      activity.backgroundCommands +
      activity.planMode +
      activity.goals >
    0
  ) {
    return true;
  }
  return false;
}

/**
 * Last real activity: live threads count as now, otherwise the latest
 * attention (completions, failures). Reads bump `updatedAt` but never
 * touch this — merely visiting a thread must not float it to Today.
 */
export function activityTime(
  thread: PluginSidebarThread,
  now: number,
): number {
  return isLiveThread(thread) ? now : thread.latestAttentionAt;
}

export type TimeGroupId = "today" | "yesterday" | "week" | "month" | "older";

export const TIME_GROUP_ORDER: readonly TimeGroupId[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

export const TIME_GROUP_LABELS: Record<TimeGroupId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  month: "Previous 30 days",
  older: "Older",
};

function startOfLocalDay(ts: number, daysAgo = 0): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

export function timeGroupFor(updatedAt: number, now: number): TimeGroupId {
  const todayStart = startOfLocalDay(now);
  if (updatedAt >= todayStart) return "today";
  if (updatedAt >= startOfLocalDay(now, 1)) return "yesterday";
  if (updatedAt >= startOfLocalDay(now, 7)) return "week";
  if (updatedAt >= startOfLocalDay(now, 30)) return "month";
  return "older";
}

// Reuse locale formatters: toLocaleDateString constructs one on every call.
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric",
});
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric",
});

export function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const date = new Date(ts);
  // Preserve Date#toLocaleDateString's fallback instead of Intl throwing.
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return (sameYear ? shortDateFormatter : fullDateFormatter).format(date);
}
