// bb-plugin-thread-cop — watches every thread and keeps stalled work moving.
//
// v1: one monitor per thread follows the thread's event log
// (bb.sdk.threads.events.list), maintaining a Pending Tool Calls list in
// tool-watch.ts; a single background service sweeps every monitor once a
// minute and delivers an "Idle Tool Nudge" steer (falling back to
// stop + fresh-turn send when steering is unavailable).
//
// v2 adds the failure-taxonomy coverage from GitHub issue #4:
// - F1+F6  failed-turn policy (`turn.failed` → retry transient failures on a
//          backoff ladder; log + tag permanent rejections; stand down when a
//          windowed rate limit or an already-queued retry is in effect)
// - F2     silent-turn watchdog (an active turn with zero events)
// - F3     approval-stall alert (a pending interaction nobody answers)
// - F4     context-pressure nudge (crossing a usage threshold)
// - F5     runaway-loop detector (identical call signatures in a window)
import type {
  BbPluginApi,
  JsonValue,
  PluginTurnFailedEvent,
} from "@get-bb/plugin-sdk";
import {
  clearThread,
  dueToolCalls,
  registerToolEnd,
  registerToolProgress,
  registerToolStart,
  shouldNudge,
  type PendingToolCallEntry,
} from "./tool-watch.js";
import {
  classifyTurnFailure,
  retryDelayMs,
} from "./tc-failures.js";
import {
  loopIsArmed,
  loopVerdict,
  markAlerted,
  noteObservedSignature,
  observeLoop,
  signatureOf,
  type LoopObservation,
} from "./tc-loops.js";

type EventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];

const SWEEP_INTERVAL_MS = 60_000;
const FOLLOWER_POLL_MS = 5_000;
// bb caps thread event pages at 100; asking for more 400s and (before 0.2.2)
// took a busy thread's follower down after five failed polls.
const FOLLOWER_POLL_LIMIT = 100;
const SEED_LIMIT = 50;
const SEED_FALLBACK_LIMIT = 100;
const MAX_MONITORS = 200;
const MAX_NUDGES = 3;
const FOLLOWER_FAILURE_LIMIT = 5;
const DEFAULT_TIMEOUT_MINUTES = 10;
export const DEFAULT_NUDGE_PROMPT =
  "Your tool call has hung and is not responding. What are your next steps?";

// v2 defaults (issue #4).
export const DEFAULT_SILENT_TURN_MINUTES = 15;
export const DEFAULT_APPROVAL_STALL_MINUTES = 10;
export const DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PCT = 85;
export const CONTEXT_PRESSURE_REARM_POINTS = 15;
export const DEFAULT_LOOP_REPEAT_COUNT = 8;
export const DEFAULT_LOOP_WINDOW_MS = 480_000;
export const DEFAULT_MAX_FAILED_TURN_RETRIES = 2;
const MAX_SILENCE_INTERVENTIONS = 2;
const ALERT_RE_ARM_MS = 60 * 60_000;

export const DEFAULT_SILENT_TURN_PROMPT =
  "This turn has gone completely silent — no events at all for a while. What are your next steps?";
export const DEFAULT_CONTEXT_PRESSURE_PROMPT =
  "Context window nearly full: summarize and compact before your next tool call.";
export const DEFAULT_LOOP_PROMPT =
  "The same call has repeated many times in a row: {signature}. This looks like a runaway loop — stop and take a different approach.";

const FOLLOWER_EVENT_TYPES = [
  "item/started",
  "item/completed",
  "item/toolCall/progress",
  "item/commandExecution/outputDelta",
  "turn/completed",
  "thread/contextWindowUsage/updated",
  "system/interaction/lifecycle",
] as const;

const COMPLETED_EVENT_TYPES = ["item/completed"] as const;

interface V2FailureRecord {
  requestId: string;
  attemptNumber: number;
  category: string | null;
  httpStatusCode: number | null;
  providerCode: string | null;
  at: number;
}

interface V2Metadata {
  lastFailure?: V2FailureRecord;
  retriedFor?: string;
  approvalAlertAt?: number;
  contextAlertAt?: number;
  loopAlertAt?: number;
}

function jsonToV2Metadata(value: JsonValue | undefined): V2Metadata {
  if (!isRecord(value)) return {};
  const lastFailure = isRecord(value["lastFailure"])
    ? (value["lastFailure"] as unknown as V2FailureRecord)
    : undefined;
  return {
    lastFailure,
    retriedFor: typeof value["retriedFor"] === "string" ? value["retriedFor"] : undefined,
    approvalAlertAt:
      typeof value["approvalAlertAt"] === "number" ? value["approvalAlertAt"] : undefined,
    contextAlertAt:
      typeof value["contextAlertAt"] === "number" ? value["contextAlertAt"] : undefined,
    loopAlertAt: typeof value["loopAlertAt"] === "number" ? value["loopAlertAt"] : undefined,
  };
}

interface ThreadMonitor {
  readonly threadId: string;
  readonly entries: PendingToolCallEntry[];
  readonly abort: AbortController;
  readonly loopBuffer: LoopObservation[];
  lastSequence: number;
  /** Epoch ms of the newest row the follower has processed (F2's clock). */
  lastEventAt: number;
  /** Whether the thread currently occupies capacity (idle/failed clear it). */
  active: boolean;
  /** Interventions already delivered for the current silence episode (F2). */
  silenceInterventions: number;
  silenceInterventedAt: number;
  /** F3: the pending interaction this monitor is waiting on. */
  interactionId: string | null;
  interactionSince: number;
  interactionAlertAt: number | null;
  /** F4: last usage percentage seen and whether the alert has fired. */
  contextPct: number | null;
  contextAlerted: boolean;
  /** F5: the signature whose run most recently tripped the loop alert. */
  lastAlertedSignature: string | null;
}

interface SweepConfig {
  timeoutMs: number;
  prompt: string;
  silentTurnMs: number;
  silentTurnPrompt: string;
  approvalStallMs: number;
  contextPressureThresholdPct: number;
  contextPressurePrompt: string;
  loopRepeatCount: number;
  loopWindowMs: number;
  loopPrompt: string;
  failedTurnRetriesEnabled: boolean;
  maxFailedTurnRetries: number;
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

/** Positive finite number guard shared by every numeric setting. */
function validNumber(value: unknown, floor: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < floor) return null;
  return value;
}

function errorInfoSummary(errorInfo: PluginTurnFailedEvent["errorInfo"]): string {
  if (errorInfo === null) return "no classification";
  return `${errorInfo.category}${errorInfo.httpStatusCode !== null ? ` (http ${errorInfo.httpStatusCode})` : ""}${errorInfo.providerCode ? ` code=${errorInfo.providerCode}` : ""}`;
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
    failedTurnRetriesEnabled: {
      type: "boolean",
      label: "Retry Failed Turns",
      description:
        "Automatically re-queue retries for transient provider failures (stream drops, overload, server errors).",
      default: true,
    },
    maxFailedTurnRetries: {
      type: "number",
      label: "Max Failed-Turn Retries",
      description:
        "How many of its own retries the plugin queues for one turn request (backoff 1m, 5m, 15m).",
      default: DEFAULT_MAX_FAILED_TURN_RETRIES,
    },
    silentTurnMinutes: {
      type: "number",
      label: "Silent Turn Timeout (minutes)",
      description:
        "An active turn with no events at all for longer than this gets a Silent Turn Nudge.",
      default: DEFAULT_SILENT_TURN_MINUTES,
    },
    silentTurnPrompt: {
      type: "string",
      experimental_multiline: true,
      label: "Silent turn nudge prompt",
      description: "The message sent to the agent when a turn goes silent.",
      default: DEFAULT_SILENT_TURN_PROMPT,
    },
    approvalStallMinutes: {
      type: "number",
      label: "Approval Stall Alert (minutes)",
      description:
        "A pending approval/question interaction older than this is loudly logged (once per interaction, re-armed hourly).",
      default: DEFAULT_APPROVAL_STALL_MINUTES,
    },
    contextPressureThresholdPct: {
      type: "number",
      label: "Context Pressure Threshold (%)",
      description:
        "Context-window usage crossing this percentage gets one nudge to summarize/compact. Re-arms 15 points below the threshold.",
      default: DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PCT,
    },
    contextPressurePrompt: {
      type: "string",
      experimental_multiline: true,
      label: "Context pressure nudge prompt",
      description: "The message sent to the agent when context pressure crosses the threshold.",
      default: DEFAULT_CONTEXT_PRESSURE_PROMPT,
    },
    loopRepeatCount: {
      type: "number",
      label: "Runaway Loop: Repeats",
      description:
        "Steer when this many identical tool/command signatures land within the window (experimental).",
      default: DEFAULT_LOOP_REPEAT_COUNT,
    },
    loopWindowMs: {
      type: "number",
      label: "Runaway Loop: Window (ms)",
      description: "The sliding window the loop detector counts identical signatures inside.",
      default: DEFAULT_LOOP_WINDOW_MS,
    },
    loopPrompt: {
      type: "string",
      experimental_multiline: true,
      label: "Runaway loop nudge prompt",
      description: "{signature} is replaced with the repeated call's signature.",
      default: DEFAULT_LOOP_PROMPT,
    },
  });

  const config: SweepConfig = {
    timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
    prompt: DEFAULT_NUDGE_PROMPT,
    silentTurnMs: DEFAULT_SILENT_TURN_MINUTES * 60_000,
    silentTurnPrompt: DEFAULT_SILENT_TURN_PROMPT,
    approvalStallMs: DEFAULT_APPROVAL_STALL_MINUTES * 60_000,
    contextPressureThresholdPct: DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PCT,
    contextPressurePrompt: DEFAULT_CONTEXT_PRESSURE_PROMPT,
    loopRepeatCount: DEFAULT_LOOP_REPEAT_COUNT,
    loopWindowMs: DEFAULT_LOOP_WINDOW_MS,
    loopPrompt: DEFAULT_LOOP_PROMPT,
    failedTurnRetriesEnabled: true,
    maxFailedTurnRetries: DEFAULT_MAX_FAILED_TURN_RETRIES,
  };

  function applySettings(values: Record<string, unknown>): void {
    const minutes = validNumber(values["toolCallTimeoutMinutes"], 0.000001);
    config.timeoutMs =
      (minutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000;
    const prompt = values["hungToolNudgePrompt"];
    config.prompt =
      typeof prompt === "string" && prompt.trim().length > 0
        ? prompt
        : DEFAULT_NUDGE_PROMPT;

    const silentTurnMinutes = validNumber(values["silentTurnMinutes"], 0.000001);
    config.silentTurnMs = (silentTurnMinutes ?? DEFAULT_SILENT_TURN_MINUTES) * 60_000;
    const silentTurnPrompt = values["silentTurnPrompt"];
    config.silentTurnPrompt =
      typeof silentTurnPrompt === "string" && silentTurnPrompt.trim().length > 0
        ? silentTurnPrompt
        : DEFAULT_SILENT_TURN_PROMPT;

    const approvalStallMinutes = validNumber(values["approvalStallMinutes"], 0.000001);
    config.approvalStallMs = (approvalStallMinutes ?? DEFAULT_APPROVAL_STALL_MINUTES) * 60_000;

    const thresholdPct = validNumber(values["contextPressureThresholdPct"], 0.000001);
    config.contextPressureThresholdPct =
      thresholdPct ?? DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PCT;
    const contextPressurePrompt = values["contextPressurePrompt"];
    config.contextPressurePrompt =
      typeof contextPressurePrompt === "string" && contextPressurePrompt.trim().length > 0
        ? contextPressurePrompt
        : DEFAULT_CONTEXT_PRESSURE_PROMPT;

    const loopRepeatCount = validNumber(values["loopRepeatCount"], 1);
    config.loopRepeatCount = Math.max(1, Math.floor(
      loopRepeatCount ?? DEFAULT_LOOP_REPEAT_COUNT,
    ));
    const loopWindowMs = validNumber(values["loopWindowMs"], 1);
    config.loopWindowMs = loopWindowMs ?? DEFAULT_LOOP_WINDOW_MS;
    const loopPrompt = values["loopPrompt"];
    config.loopPrompt =
      typeof loopPrompt === "string" && loopPrompt.trim().length > 0
        ? loopPrompt
        : DEFAULT_LOOP_PROMPT;

    config.failedTurnRetriesEnabled = values["failedTurnRetriesEnabled"] !== false;
    const maxRetries = validNumber(values["maxFailedTurnRetries"], 0);
    config.maxFailedTurnRetries = Math.max(0, Math.floor(
      maxRetries ?? DEFAULT_MAX_FAILED_TURN_RETRIES,
    ));
  }

  applySettings(await settings.get());
  settings.onChange((next) => applySettings(next as Record<string, unknown>));

  const monitors = new Map<string, ThreadMonitor>();

  /** Read this plugin's v2 bookkeeping key for a thread ({} when unset/unreadable). */
  async function readV2Metadata(threadId: string): Promise<V2Metadata> {
    try {
      const result = await bb.sdk.threads.getPluginMetadata({ threadId });
      return jsonToV2Metadata((result as Record<string, JsonValue | undefined>)["v2"]);
    } catch {
      return {};
    }
  }

  /** Merge-write one v2 metadata subkey; metadata failures never break the policy. */
  async function writeV2Metadata(
    threadId: string,
    patch: Partial<V2Metadata>,
  ): Promise<void> {
    try {
      const prev = await readV2Metadata(threadId);
      const v2 = { ...prev, ...patch };
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { v2: v2 as unknown as JsonValue },
      });
    } catch (err) {
      bb.log.warn(
        `thread-cop: failed to update v2 metadata for ${threadId} (${errText(err)})`,
      );
    }
  }

  function freshMonitor(threadId: string, now: number): ThreadMonitor {
    return {
      threadId,
      entries: [],
      abort: new AbortController(),
      loopBuffer: [],
      lastSequence: 0,
      lastEventAt: now,
      active: false,
      silenceInterventions: 0,
      silenceInterventedAt: 0,
      interactionId: null,
      interactionSince: 0,
      interactionAlertAt: null,
      contextPct: null,
      contextAlerted: false,
      lastAlertedSignature: null,
    };
  }

  function processEventRow(
    monitor: ThreadMonitor,
    row: EventRow,
    opts: { seeding?: boolean } = {},
  ): void {
    if (row.seq > monitor.lastSequence) monitor.lastSequence = row.seq;
    // Every row refreshes the silence clock (F2), not just progress events.
    if (row.createdAt > monitor.lastEventAt) monitor.lastEventAt = row.createdAt;
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
        // F5: the real command text only reaches the log on completion
        // (started rows carry the shell binary), so commandExecution
        // signatures are keyed here. History seeding never feeds the loop
        // buffer: replaying old rows would re-fire loops that already ran
        // before the plugin attached.
        if (opts.seeding !== true) {
          const signature = loopSignatureFromItem(item);
          if (signature !== null) recordLoopSignature(monitor, signature, row.createdAt);
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
        monitor.silenceInterventions = 0;
        monitor.silenceInterventedAt = 0;
        return;
      }
      case "system/interaction/lifecycle": {
        if (!isRecord(data)) return;
        const interaction = data["interaction"];
        if (!isRecord(interaction)) return;
        const id = interaction["id"];
        const status = interaction["status"];
        if (typeof id !== "string" || typeof status !== "string") return;
        if (status === "pending") {
          if (monitor.interactionId !== id) {
            monitor.interactionId = id;
            monitor.interactionSince = row.createdAt;
            monitor.interactionAlertAt = null;
          }
        } else if (monitor.interactionId === id) {
          monitor.interactionId = null;
          monitor.interactionSince = 0;
          monitor.interactionAlertAt = null;
        }
        return;
      }
      case "thread/contextWindowUsage/updated": {
        if (!isRecord(data)) return;
        const usage = data["contextWindowUsage"];
        if (!isRecord(usage)) return;
        const usedTokens = usage["usedTokens"];
        let windowTokens = usage["modelContextWindow"];
        if (typeof windowTokens !== "number" || !(windowTokens > 0)) {
          const snapshot = usage["snapshot"];
          if (isRecord(snapshot)) {
            const snapshotWindow = snapshot["contextWindowTokens"];
            if (typeof snapshotWindow === "number" && snapshotWindow > 0) {
              windowTokens = snapshotWindow;
            } else {
              windowTokens = null;
            }
          } else {
            windowTokens = null;
          }
        }
        if (
          typeof usedTokens !== "number" ||
          usedTokens < 0 ||
          typeof windowTokens !== "number" ||
          !(windowTokens > 0)
        ) {
          return;
        }
        monitor.contextPct = Math.min(100, (usedTokens / windowTokens) * 100);
        if (monitor.contextPct < config.contextPressureThresholdPct - CONTEXT_PRESSURE_REARM_POINTS) {
          monitor.contextAlerted = false;
        }
        return;
      }
      default:
        return;
    }
  }

  /** F5: any event-log item the detector can sign — command text or a toolCall with visible input. */
  function loopSignatureFromItem(item: Record<string, unknown>): string | null {
    if (item["type"] === "commandExecution") {
      return signatureOf({
        kind: "command",
        command: typeof item["command"] === "string" ? item["command"] : "",
      });
    }
    if (item["type"] === "toolCall") {
      const input = item["input"] ?? item["arguments"];
      return signatureOf({ kind: "tool", name: String(item["tool"] ?? ""), input });
    }
    return null;
  }

  /** F5: observe one signed call and steer when a loop trip lands. */
  function recordLoopSignature(
    monitor: ThreadMonitor,
    signature: string,
    at: number,
  ): void {
    // A distinct signature re-arms the detector (F5's re-arm rule).
    monitor.lastAlertedSignature = noteObservedSignature(
      monitor.lastAlertedSignature,
      signature,
    );
    observeLoop(monitor.loopBuffer, signature, at, config.loopWindowMs);
    const verdict = loopVerdict(
      monitor.loopBuffer,
      signature,
      at,
      config.loopWindowMs,
      config.loopRepeatCount,
    );
    if (verdict.tripped && loopIsArmed(monitor.lastAlertedSignature, signature)) {
      monitor.lastAlertedSignature = markAlerted(monitor.loopBuffer, signature);
      void deliverSteerWithFallback(
        monitor.threadId,
        `Runaway Loop Nudge: ${config.loopPrompt.replaceAll("{signature}", signature)}`,
        "loop",
      ).then(() =>
        writeV2Metadata(monitor.threadId, { loopAlertAt: Date.now() }),
      );
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
    for (const row of rows) processEventRow(monitor, row, { seeding: true });
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

  async function attachMonitor(threadId: string, active: boolean): Promise<void> {
    if (monitors.has(threadId)) {
      const existing = monitors.get(threadId)!;
      if (active) existing.active = true;
      return;
    }
    if (monitors.size >= MAX_MONITORS) {
      bb.log.warn(
        `thread-cop: monitor cap (${MAX_MONITORS}) reached, not watching ${threadId}`,
      );
      return;
    }
    const monitor = freshMonitor(threadId, Date.now());
    monitor.active = active;
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
    if (!monitor) return;
    clearThread(monitor.entries, threadId);
    monitor.active = false;
    monitor.silenceInterventions = 0;
    monitor.silenceInterventedAt = 0;
    monitor.interactionId = null;
    monitor.interactionSince = 0;
    monitor.interactionAlertAt = null;
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

  /** Steer `text` into the running turn; if steering is unavailable, stop and start a fresh turn. */
  async function deliverSteerWithFallback(
    threadId: string,
    text: string,
    kind: string,
  ): Promise<"steer" | "stop+start"> {
    const input = nudgeInput(text);
    try {
      await bb.sdk.threads.send({ threadId, input, mode: "steer" });
      bb.log.info(
        `thread-cop: sent ${kind} to ${threadId} via steer`,
      );
      return "steer";
    } catch (err) {
      bb.log.info(
        `thread-cop: steer unavailable for ${threadId} (${errText(err)}); interrupting and starting a fresh turn`,
      );
    }
    await bb.sdk.threads.stop({ threadId });
    await bb.sdk.threads.send({ threadId, input, mode: "start" });
    bb.log.info(
      `thread-cop: decided to send ${kind} to ${threadId} via stop + fresh turn`,
    );
    return "stop+start";
  }

  async function deliverNudge(
    monitor: ThreadMonitor,
    entry: PendingToolCallEntry,
    prompt: string,
  ): Promise<void> {
    await deliverSteerWithFallback(
      monitor.threadId,
      `Idle Tool Nudge: ${prompt}`,
      `hung tool call nudge (${entry.tool} ${entry.itemId})`,
    );
    entry.nudgedAt.push(Date.now());
  }

  // F1 + F6: the failed-turn policy, driven by turn.failed announcements.
  bb.events.on("turn.failed", async (payload) => {
    const { threadId, requestId, errorInfo, rateLimits, attemptNumber } = payload;
    try {
      // Stand down when core already queued the verbatim retry (a windowed
      // rate limit) or any retry of this chain is still queued.
      let queuedRetries = 0;
      try {
        const queued = await bb.sdk.threads.queuedMessages.list({ threadId });
        queuedRetries = (queued as { length?: number }).length ?? 0;
      } catch {
        queuedRetries = 0;
      }
      const classification = classifyTurnFailure(
        { errorInfo, rateLimits, attemptNumber, queuedRetries },
        config.maxFailedTurnRetries,
      );
      if (classification === "stand-down") {
        bb.log.info(
          `thread-cop: standing down for ${threadId} turn ${requestId} — a rate-limit window or a queued retry is already handling it`,
        );
        return;
      }
      if (classification === "escalate" || !config.failedTurnRetriesEnabled) {
        const summary = errorInfoSummary(errorInfo);
        bb.log.warn(
          `thread-cop: FAILED TURN in ${threadId} (request ${requestId}, attempt ${attemptNumber}): ${summary} — not retrying, human attention needed`,
        );
        await writeV2Metadata(threadId, {
          lastFailure: {
            requestId,
            attemptNumber,
            category: errorInfo?.category ?? null,
            httpStatusCode: errorInfo?.httpStatusCode ?? null,
            providerCode: errorInfo?.providerCode ?? null,
            at: Date.now(),
          },
        });
        return;
      }
      // Retry (A1): guard against reload-driven double retries, record the
      // intent first, then queue the retry on the backoff ladder.
      const prev = await readV2Metadata(threadId);
      if (prev.retriedFor === requestId) {
        bb.log.debug(
          `thread-cop: retry for ${threadId} turn ${requestId} already recorded (reload guard)`,
        );
        return;
      }
      const delayMs = retryDelayMs(attemptNumber, config.maxFailedTurnRetries);
      const sendAt = Date.now() + delayMs;
      await writeV2Metadata(threadId, { retriedFor: requestId });
      await bb.sdk.threads.retry({
        threadId,
        turnRequestId: requestId,
        sendAt,
        reason: `Thread Cop: transient provider failure (${errorInfoSummary(errorInfo)}), auto-retry ${attemptNumber}/${config.maxFailedTurnRetries}`,
      });
      bb.log.info(
        `thread-cop: queued retry for ${threadId} turn ${requestId} (attempt ${attemptNumber}) in ${Math.round(delayMs / 1000)}s`,
      );
    } catch (err) {
      bb.log.warn(
        `thread-cop: failed-turn policy failed for ${threadId} (${errText(err)})`,
      );
    }
  });

  // F2: silent-turn watchdog.
  async function checkSilence(monitor: ThreadMonitor, now: number): Promise<void> {
    if (!monitor.active) return;
    if (monitor.interactionId !== null) return; // the agent cannot respond while blocked
    if (monitor.entries.length > 0) return; // a watched tool call owns this thread (B1)
    const lastActivity = Math.max(
      monitor.lastEventAt,
      monitor.silenceInterventedAt,
    );
    if (now - lastActivity <= config.silentTurnMs) return;
    if (monitor.silenceInterventions >= MAX_SILENCE_INTERVENTIONS) return;
    const count = monitor.silenceInterventions;
    monitor.silenceInterventions = count + 1;
    monitor.silenceInterventedAt = now;
    if (count === 0) {
      await deliverSteerWithFallback(
        monitor.threadId,
        `Silent Turn Nudge: ${config.silentTurnPrompt}`,
        `silent turn nudge`,
      );
    } else {
      // Escalation: still silent after another full window — interrupt.
      try {
        await bb.sdk.threads.stop({ threadId: monitor.threadId });
        await bb.sdk.threads.send({
          threadId: monitor.threadId,
          input: nudgeInput(`Silent Turn Nudge: ${config.silentTurnPrompt}`),
          mode: "start",
        });
        bb.log.warn(
          `thread-cop: silent turn in ${monitor.threadId} escalated to stop + fresh turn (${count + 1}/${MAX_SILENCE_INTERVENTIONS})`,
        );
      } catch (err) {
        bb.log.warn(
          `thread-cop: silent-turn escalation failed for ${monitor.threadId} (${errText(err)})`,
        );
      }
    }
  }

  // F3: approval-stall alert — deliberately NOT a steer (the agent is
  // blocked on a human; a queued send would fire the moment the human
  // answers and corrupt the context).
  async function checkInteractionStall(
    monitor: ThreadMonitor,
    now: number,
  ): Promise<void> {
    if (monitor.interactionId === null) return;
    const stalledFor = now - monitor.interactionSince;
    if (stalledFor <= config.approvalStallMs) return;
    const hourly =
      monitor.interactionAlertAt === null ||
      now - monitor.interactionAlertAt >= ALERT_RE_ARM_MS;
    if (!hourly) return;
    monitor.interactionAlertAt = now;
    const minutes = Math.round(stalledFor / 60_000);
    bb.log.warn(
      `thread-cop: APPROVAL STALL in ${monitor.threadId}: interaction ${monitor.interactionId} has been pending for ${minutes} min — a human answer is needed`,
    );
    await writeV2Metadata(monitor.threadId, { approvalAlertAt: now });
  }

  // F4: context-pressure nudge — one steer on crossing the threshold;
  // (re-)arms after usage falls back below threshold − 15 points.
  async function checkContextPressure(monitor: ThreadMonitor, now: number): Promise<void> {
    if (
      monitor.contextPct === null ||
      monitor.contextAlerted ||
      monitor.contextPct < config.contextPressureThresholdPct
    ) {
      return;
    }
    monitor.contextAlerted = true;
    const pct = Math.round(monitor.contextPct);
    try {
      await deliverSteerWithFallback(
        monitor.threadId,
        `Context Pressure Nudge: ${config.contextPressurePrompt}`,
        `context pressure nudge (${pct}%)`,
      );
    } catch (err) {
      monitor.contextAlerted = false;
      bb.log.warn(
        `thread-cop: context-pressure nudge failed for ${monitor.threadId} (${errText(err)})`,
      );
      return;
    }
    await writeV2Metadata(monitor.threadId, { contextAlertAt: now });
  }

  // F5: runaway loop — delivered live from the observation path above; the
  // sweep has nothing more to add, so no check function exists for it.

  async function sweepOnce(): Promise<void> {
    const now = Date.now();
    let nudged = 0;
    for (const monitor of [...monitors.values()]) {
      for (const entry of dueToolCalls(monitor.entries, now, config.timeoutMs)) {
        if (!shouldNudge(entry, now, config.timeoutMs, MAX_NUDGES)) continue;
        try {
          // Re-check the item right before sending: a completion that raced
          // the sweep cancels the nudge.
          if (await itemEndedSince(monitor, entry.itemId)) {
            registerToolEnd(monitor.entries, monitor.threadId, entry.itemId);
            continue;
          }
          await deliverNudge(monitor, entry, config.prompt);
          nudged += 1;
        } catch (err) {
          bb.log.warn(
            `thread-cop: nudge failed for ${monitor.threadId}/${entry.itemId} (${errText(err)})`,
          );
        }
      }
      // v2 checks, each independently skippable, in the documented order:
      // F2 silence → (F1/F6 are event-driven) → F3 interaction → F4 context
      // → F5 loop (delivered live from the observation path).
      for (const [check, what] of [
        [checkSilence, "silent-turn"],
        [checkInteractionStall, "interaction-stall"],
        [checkContextPressure, "context-pressure"],
      ] as const) {
        try {
          await check(monitor, now);
        } catch (err) {
          bb.log.warn(
            `thread-cop: ${what} check failed for ${monitor.threadId} (${errText(err)})`,
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
    await attachMonitor(thread.id, thread.status === "active");
  });
  bb.events.on("thread.active", async ({ thread }) => {
    await attachMonitor(thread.id, true);
  });
  bb.events.on("thread.unarchived", async ({ thread }) => {
    await attachMonitor(thread.id, thread.status === "active");
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
      await attachMonitor(thread.id, true);
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
