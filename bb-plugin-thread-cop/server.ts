// bb-plugin-thread-cop — watches every thread's tool calls and nudges the
// agent when one hangs past the configured timeout.
//
// One monitor per thread follows the thread's event log
// (bb.sdk.threads.events.list), maintaining a Pending Tool Calls list in
// tool-watch.ts; a single background service sweeps every monitor once a
// minute and delivers an "Idle Tool Nudge" steer (falling back to
// stop + fresh-turn send when steering is unavailable).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  clearThread,
  dueToolCalls,
  registerToolEnd,
  registerToolProgress,
  registerToolStart,
  shouldNudge,
  type PendingToolCallEntry,
} from "./tool-watch.js";

type EventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];

const SWEEP_INTERVAL_MS = 60_000;
const FOLLOWER_POLL_MS = 5_000;
const FOLLOWER_POLL_LIMIT = 500;
const SEED_LIMIT = 50;
const SEED_FALLBACK_LIMIT = 500;
const MAX_MONITORS = 200;
const MAX_NUDGES = 3;
const FOLLOWER_FAILURE_LIMIT = 5;
const DEFAULT_TIMEOUT_MINUTES = 10;
export const DEFAULT_NUDGE_PROMPT =
  "Your tool call has hung and is not responding. What are your next steps?";

const FOLLOWER_EVENT_TYPES = [
  "item/started",
  "item/completed",
  "item/toolCall/progress",
  "item/commandExecution/outputDelta",
  "turn/completed",
] as const;

const COMPLETED_EVENT_TYPES = ["item/completed"] as const;

interface ThreadMonitor {
  readonly threadId: string;
  readonly entries: PendingToolCallEntry[];
  readonly abort: AbortController;
  lastSequence: number;
}

interface SweepConfig {
  timeoutMs: number;
  prompt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** The nudge message as a start/steer input block. */
function nudgeInput(text: string): { mentions: never[]; text: string; type: "text" }[] {
  return [{ mentions: [], text, type: "text" }];
}

/** The tool name of an event-log item, or null when the item is not watchable. */
function toolNameOfItem(item: Record<string, unknown>): string | null {
  if (item["type"] === "toolCall") {
    const tool = item["tool"];
    return typeof tool === "string" ? tool : null;
  }
  if (item["type"] === "commandExecution") {
    const command = item["command"];
    return typeof command === "string" ? command : null;
  }
  return null;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    toolCallTimeoutMinutes: {
      type: "number",
      label: "Tool Call Timeout (minutes)",
      description:
        "A tool call with no start or progress for longer than this is considered hung and gets an Idle Tool Nudge.",
      default: DEFAULT_TIMEOUT_MINUTES,
    },
    hungToolNudgePrompt: {
      type: "string",
      experimental_multiline: true,
      label: "Hung Tool nudge prompt",
      description: "The message sent to the agent when a tool call hangs.",
      default: DEFAULT_NUDGE_PROMPT,
    },
  });

  const config: SweepConfig = {
    timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
    prompt: DEFAULT_NUDGE_PROMPT,
  };

  function applySettings(values: {
    toolCallTimeoutMinutes?: number | undefined;
    hungToolNudgePrompt?: string | undefined;
  }): void {
    const minutes = values.toolCallTimeoutMinutes;
    config.timeoutMs =
      typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
        ? minutes * 60_000
        : DEFAULT_TIMEOUT_MINUTES * 60_000;
    const prompt = values.hungToolNudgePrompt;
    config.prompt =
      typeof prompt === "string" && prompt.trim().length > 0
        ? prompt
        : DEFAULT_NUDGE_PROMPT;
  }

  applySettings(await settings.get());
  settings.onChange((next) => applySettings(next));

  const monitors = new Map<string, ThreadMonitor>();

  function processEventRow(monitor: ThreadMonitor, row: EventRow): void {
    if (row.seq > monitor.lastSequence) monitor.lastSequence = row.seq;
    const data: unknown = row.data;
    switch (row.type) {
      case "item/started": {
        if (!isRecord(data)) return;
        const item = data["item"];
        if (!isRecord(item)) return;
        const id = item["id"];
        if (typeof id !== "string") return;
        const status = item["status"];
        if (status === "pending") {
          const tool = toolNameOfItem(item);
          if (tool === null) return;
          registerToolStart(monitor.entries, monitor.threadId, {
            itemId: id,
            tool,
            startedAt: row.createdAt,
          });
        } else {
          registerToolEnd(monitor.entries, monitor.threadId, id);
        }
        return;
      }
      case "item/completed": {
        if (!isRecord(data)) return;
        const item = data["item"];
        if (!isRecord(item)) return;
        const id = item["id"];
        if (typeof id === "string") {
          registerToolEnd(monitor.entries, monitor.threadId, id);
        }
        return;
      }
      case "item/toolCall/progress":
      case "item/commandExecution/outputDelta": {
        if (!isRecord(data)) return;
        const itemId = data["itemId"];
        if (typeof itemId === "string") {
          registerToolProgress(
            monitor.entries,
            monitor.threadId,
            itemId,
            row.createdAt,
          );
        }
        return;
      }
      case "turn/completed": {
        clearThread(monitor.entries, monitor.threadId);
        return;
      }
      default:
        return;
    }
  }

  async function listEvents(
    monitor: ThreadMonitor,
    opts: { desc?: boolean; limit?: number } = {},
  ): Promise<EventRow[]> {
    return await bb.sdk.threads.events.list({
      threadId: monitor.threadId,
      ...(monitor.lastSequence > 0
        ? { afterSeq: String(monitor.lastSequence) }
        : {}),
      types: FOLLOWER_EVENT_TYPES,
      ...(opts.desc === true
        ? { order: "desc" as const, limit: String(opts.limit ?? SEED_LIMIT) }
        : { limit: String(opts.limit ?? FOLLOWER_POLL_LIMIT) }),
    });
  }

  /** Seed the pending list from recent history so a hang predating the follower is caught. */
  async function seedMonitor(monitor: ThreadMonitor): Promise<void> {
    let rows: EventRow[];
    try {
      rows = [...(await listEvents(monitor, { desc: true }))].sort(
        (a, b) => a.seq - b.seq,
      );
    } catch (err) {
      bb.log.warn(
        `thread-cop: descending seed listing failed for ${monitor.threadId} (${errText(err)}); falling back to ascending history`,
      );
      rows = await listEvents(monitor, { limit: SEED_FALLBACK_LIMIT });
    }
    for (const row of rows) processEventRow(monitor, row);
  }

  async function runFollower(monitor: ThreadMonitor): Promise<void> {
    let failures = 0;
    while (!monitor.abort.signal.aborted) {
      await sleep(FOLLOWER_POLL_MS, monitor.abort.signal);
      if (monitor.abort.signal.aborted) return;
      try {
        const rows = await listEvents(monitor);
        for (const row of rows) processEventRow(monitor, row);
        failures = 0;
      } catch (err) {
        failures += 1;
        if (failures >= FOLLOWER_FAILURE_LIMIT) {
          bb.log.warn(
            `thread-cop: dropping follower for ${monitor.threadId} after ${failures} failed polls (${errText(err)})`,
          );
          teardownMonitor(monitor.threadId);
          return;
        }
      }
    }
  }

  async function attachMonitor(threadId: string): Promise<void> {
    if (monitors.has(threadId)) return;
    if (monitors.size >= MAX_MONITORS) {
      bb.log.warn(
        `thread-cop: monitor cap (${MAX_MONITORS}) reached, not watching ${threadId}`,
      );
      return;
    }
    const monitor: ThreadMonitor = {
      threadId,
      entries: [],
      abort: new AbortController(),
      lastSequence: 0,
    };
    monitors.set(threadId, monitor);
    try {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { watchdog: "watching" },
      });
    } catch (err) {
      bb.log.warn(
        `thread-cop: failed to tag ${threadId} (${errText(err)})`,
      );
    }
    try {
      await seedMonitor(monitor);
    } catch (err) {
      bb.log.warn(
        `thread-cop: seed failed for ${threadId} (${errText(err)})`,
      );
    }
    void runFollower(monitor).catch((err) => {
      bb.log.warn(
        `thread-cop: follower crashed for ${threadId} (${errText(err)})`,
      );
    });
  }

  function teardownMonitor(threadId: string): void {
    const monitor = monitors.get(threadId);
    if (!monitor) return;
    monitors.delete(threadId);
    monitor.abort.abort();
  }

  function drainMonitor(threadId: string): void {
    const monitor = monitors.get(threadId);
    if (monitor) clearThread(monitor.entries, threadId);
  }

  async function itemEndedSince(
    monitor: ThreadMonitor,
    itemId: string,
  ): Promise<boolean> {
    const rows = await bb.sdk.threads.events.list({
      threadId: monitor.threadId,
      ...(monitor.lastSequence > 0
        ? { afterSeq: String(monitor.lastSequence) }
        : {}),
      types: COMPLETED_EVENT_TYPES,
    });
    for (const row of rows) {
      const data: unknown = row.data;
      if (!isRecord(data)) continue;
      const item = data["item"];
      if (isRecord(item) && item["id"] === itemId) return true;
    }
    return false;
  }

  async function deliverNudge(
    monitor: ThreadMonitor,
    entry: PendingToolCallEntry,
    prompt: string,
  ): Promise<void> {
    const threadId = monitor.threadId;
    const text = `Idle Tool Nudge: ${prompt}`;
    const input = nudgeInput(text);
    try {
      await bb.sdk.threads.send({ threadId, input, mode: "steer" });
      entry.nudgedAt.push(Date.now());
      bb.log.info(
        `thread-cop: nudged hung tool call ${entry.tool} (${entry.itemId}) in ${threadId} via steer`,
      );
      return;
    } catch (err) {
      bb.log.info(
        `thread-cop: steer unavailable for ${threadId} (${errText(err)}); interrupting and starting a fresh turn`,
      );
    }
    await bb.sdk.threads.stop({ threadId });
    await bb.sdk.threads.send({ threadId, input, mode: "start" });
    entry.nudgedAt.push(Date.now());
    bb.log.info(
      `thread-cop: nudged hung tool call ${entry.tool} (${entry.itemId}) in ${threadId} via stop + fresh turn`,
    );
  }

  async function sweepOnce(): Promise<void> {
    const { timeoutMs, prompt } = config;
    const now = Date.now();
    let nudged = 0;
    for (const monitor of [...monitors.values()]) {
      for (const entry of dueToolCalls(monitor.entries, now, timeoutMs)) {
        if (!shouldNudge(entry, now, timeoutMs, MAX_NUDGES)) continue;
        try {
          // Re-check the item right before sending: a completion that raced
          // the sweep cancels the nudge.
          if (await itemEndedSince(monitor, entry.itemId)) {
            registerToolEnd(monitor.entries, monitor.threadId, entry.itemId);
            continue;
          }
          await deliverNudge(monitor, entry, prompt);
          nudged += 1;
        } catch (err) {
          bb.log.warn(
            `thread-cop: nudge failed for ${monitor.threadId}/${entry.itemId} (${errText(err)})`,
          );
        }
      }
    }
    bb.log.debug(
      `thread-cop: sweep complete (${monitors.size} monitored, ${nudged} nudge${nudged === 1 ? "" : "s"})`,
    );
  }

  bb.background.service("tool-hang-sweep", {
    start(signal) {
      return (async () => {
        while (!signal.aborted) {
          try {
            await sweepOnce();
          } catch (err) {
            bb.log.warn(`thread-cop: sweep failed (${errText(err)})`);
          }
          await sleep(SWEEP_INTERVAL_MS, signal);
        }
      })();
    },
  });

  bb.events.on("thread.created", async ({ thread }) => {
    await attachMonitor(thread.id);
  });
  bb.events.on("thread.active", async ({ thread }) => {
    await attachMonitor(thread.id);
  });
  bb.events.on("thread.unarchived", async ({ thread }) => {
    await attachMonitor(thread.id);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    drainMonitor(thread.id);
  });
  bb.events.on("thread.failed", ({ thread }) => {
    drainMonitor(thread.id);
  });
  bb.events.on("thread.archived", ({ thread }) => {
    teardownMonitor(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    teardownMonitor(thread.id);
  });

  // Load-time scan: pick up every thread already occupying capacity so a
  // plugin reload re-attaches surviving waiters.
  try {
    const running = await bb.sdk.threads.listRunning();
    for (const thread of running) {
      await attachMonitor(thread.id);
    }
  } catch (err) {
    bb.log.warn(`thread-cop: load-time scan failed (${errText(err)})`);
  }

  bb.onDispose(() => {
    for (const monitor of monitors.values()) monitor.abort.abort();
    monitors.clear();
  });

  bb.log.info(
    `thread-cop: loaded (timeout ${config.timeoutMs / 60_000} min, ${monitors.size} thread(s) monitored)`,
  );
}
