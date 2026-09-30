import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, { DEFAULT_NUDGE_PROMPT } from "./server.js";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const FOLLOWER_POLL_MS = 5_000;

type AnyRow = {
  id: string;
  scope: { kind: "thread" };
  threadId: string;
  seq: number;
  createdAt: number;
  type: string;
  data: unknown;
};

function row(
  threadId: string,
  seq: number,
  type: string,
  data: unknown,
  createdAt: number,
): AnyRow {
  return { id: `ev_${threadId}_${seq}`, scope: { kind: "thread" }, threadId, seq, createdAt, type, data };
}

function toolCallItem(id: string, status: string, tool = "Task") {
  return { type: "toolCall", id, status, tool };
}

function startedRow(
  threadId: string,
  seq: number,
  item: ReturnType<typeof toolCallItem>,
  createdAt: number,
) {
  return row(threadId, seq, "item/started", { item }, createdAt);
}

function completedRow(
  threadId: string,
  seq: number,
  item: ReturnType<typeof toolCallItem>,
  createdAt: number,
) {
  return row(threadId, seq, "item/completed", { item }, createdAt);
}

function progressRow(threadId: string, seq: number, itemId: string, createdAt: number) {
  return row(threadId, seq, "item/toolCall/progress", { itemId, message: "still working" }, createdAt);
}

function turnCompletedRow(threadId: string, seq: number, createdAt: number) {
  return row(threadId, seq, "turn/completed", { status: "completed" }, createdAt);
}

function interactionRow(
  threadId: string,
  seq: number,
  interactionId: string,
  status: string,
  createdAt: number,
) {
  return row(
    threadId,
    seq,
    "system/interaction/lifecycle",
    { interaction: { id: interactionId, status, origin: { kind: "provider" } } },
    createdAt,
  );
}

function contextUsageRow(
  threadId: string,
  seq: number,
  usedTokens: number,
  modelContextWindow: number,
  createdAt: number,
) {
  return row(
    threadId,
    seq,
    "thread/contextWindowUsage/updated",
    { contextWindowUsage: { usedTokens, modelContextWindow, estimated: false } },
    createdAt,
  );
}

function commandStartedRow(
  threadId: string,
  seq: number,
  itemId: string,
  command: string,
  createdAt: number,
) {
  return row(
    threadId,
    seq,
    "item/started",
    { item: { type: "commandExecution", id: itemId, status: "pending", command } },
    createdAt,
  );
}

/**
 * A completed commandExecution row: the real command text only reaches the
 * log here (started rows carry just the shell binary).
 */
function commandCompletedRow(
  threadId: string,
  seq: number,
  itemId: string,
  command: string,
  createdAt: number,
) {
  return row(
    threadId,
    seq,
    "item/completed",
    { item: { type: "commandExecution", id: itemId, status: "completed", command } },
    createdAt,
  );
}

function turnFailedPayload(
  overrides: Partial<PluginTurnFailedEvent> = {},
): PluginTurnFailedEvent {
  return {
    threadId: "th_1",
    requestId: "req_1",
    turnId: "turn_1",
    errorInfo: { category: "bad-request", httpStatusCode: 400, providerCode: null },
    inputAccepted: false,
    rateLimits: null,
    attemptNumber: 1,
    ...overrides,
  };
}

async function emitTurnFailed(host: Host, payload: TurnFailedPayload): Promise<void> {
  const emitted = await host.harness.behavior.emitThreadEvent("turn.failed", payload);
  expect(emitted.errors).toEqual([]);
}

/** Attach a thread no pending tool calls, occupying capacity. */
async function emitThreadCreated(host: Host, threadId: string): Promise<void> {
  const emitted = await host.harness.behavior.emitThreadEvent("thread.created", {
    thread: makeThreadResponse({ id: threadId, status: "active" }),
  });
  expect(emitted.errors).toEqual([]);
}

async function attachQuietThread(host: Host, threadId: string): Promise<void> {
  host.eventLogs.set(threadId, []);
  await emitThreadCreated(host, threadId);
}

async function advanceFollower(): Promise<void> {
  await vi.advanceTimersByTimeAsync(FOLLOWER_POLL_MS);
}

type SendCall = {
  threadId: string;
  mode: string;
  input: unknown[];
};

type RetryCall = {
  threadId: string;
  turnRequestId?: string;
  sendAt?: number;
  reason?: string;
};

type TurnFailedPayload = PluginTurnFailedEvent;

function newHost() {
  const eventLogs = new Map<string, AnyRow[]>();
  const sends: SendCall[] = [];
  const stops: unknown[] = [];
  const metadataUpdates: unknown[] = [];
  const threadMetadata = new Map<string, Record<string, unknown>>();
  const retries: RetryCall[] = [];
  const queuedRows = new Map<string, unknown[]>();
  let listRunningResult: Array<{ id: string; hostId: string }> = [];
  let sendImpl: (args: SendCall) => Promise<unknown> = async (args) => {
    sends.push(args);
    return {};
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-plugin-thread-cop",
    sdk: {
      threads: {
        listRunning: async () => listRunningResult,
        updatePluginMetadata: async (args: unknown) => {
          metadataUpdates.push(args);
          const a = args as { threadId: string; set?: Record<string, unknown> };
          const stored = threadMetadata.get(a.threadId) ?? {};
          threadMetadata.set(a.threadId, { ...stored, ...(a.set ?? {}) });
          return threadMetadata.get(a.threadId);
        },
        getPluginMetadata: async (args: unknown) => {
          const a = args as { threadId: string };
          return threadMetadata.get(a.threadId) ?? {};
        },
        queuedMessages: {
          list: async (args: unknown) => {
            const a = args as { threadId: string };
            return queuedRows.get(a.threadId) ?? [];
          },
        },
        retry: async (args: RetryCall) => {
          retries.push(args);
          return {};
        },
        events: {
          list: async (args: {
            threadId: string;
            afterSeq?: string;
            limit?: string;
            order?: "asc" | "desc";
            types?: readonly string[];
          }) => {
            const rows = eventLogs.get(args.threadId) ?? [];
            const after = args.afterSeq === undefined ? 0 : Number(args.afterSeq);
            let out = rows.filter((r) => r.seq > after);
            if (args.types) {
              out = out.filter((r) => args.types!.includes(r.type));
            }
            out = [...out].sort((a, b) =>
              args.order === "desc" ? b.seq - a.seq : a.seq - b.seq,
            );
            const limit = args.limit === undefined ? undefined : Number(args.limit);
            if (limit !== undefined) out = out.slice(0, limit);
            return out;
          },
        },
        send: async (args: SendCall) => sendImpl(args),
        stop: async (args: unknown) => {
          stops.push(args);
          return { ok: true };
        },
      },
    },
  });
  return {
    bb,
    harness,
    eventLogs,
    sends,
    stops,
    metadataUpdates,
    threadMetadata,
    retries,
    queuedRows,
    setListRunning(value: Array<{ id: string; hostId: string }>) {
      listRunningResult = value;
    },
    setSendImpl(value: (args: SendCall) => Promise<unknown>) {
      sendImpl = value;
    },
  };
}

type Host = ReturnType<typeof newHost>;

let currentHost: Host | null = null;

function freshHost(): Host {
  currentHost = newHost();
  return currentHost;
}

async function spin(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 20_000; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function inputText(send: SendCall): string {
  return (send.input[0] as { text: string }).text;
}

function sweepCount(harness: Host["harness"]): number {
  return harness.logEntries.filter(
    (e) => e.level === "debug" && e.message.includes("sweep complete"),
  ).length;
}

async function runSweep(harness: Host["harness"]): Promise<void> {
  const before = sweepCount(harness);
  const svc = harness.behavior.runService("tool-hang-sweep");
  try {
    await spin(() => sweepCount(harness) > before, "sweep tick");
  } finally {
    svc.controller.abort();
    await svc.done;
  }
}

async function attachHungThread(
  host: Host,
  threadId: string,
  itemId: string,
  startedAt: number,
): Promise<void> {
  host.eventLogs.set(threadId, [startedRow(threadId, 1, toolCallItem(itemId, "pending"), startedAt)]);
  const emitted = await host.harness.behavior.emitThreadEvent("thread.created", {
    thread: makeThreadResponse({ id: threadId, status: "active" }),
  });
  expect(emitted.errors).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(T0);
});

afterEach(async () => {
  await currentHost?.harness.lifecycle.dispose();
  currentHost = null;
  vi.useRealTimers();
});

describe("bb-plugin-thread-cop", () => {
  it("defines settings with the documented defaults", async () => {
    const host = freshHost();
    await plugin(host.bb);
    const descriptors = host.harness.inspection.registrations.settingsDescriptors;
    expect(descriptors.toolCallTimeoutMinutes).toMatchObject({ type: "number", default: 10 });
    expect(descriptors.hungToolNudgePrompt).toMatchObject({
      type: "string",
      experimental_multiline: true,
      default: DEFAULT_NUDGE_PROMPT,
    });
  });

  it("attaches on thread.created, tags pluginMetadata, nudges once per hang window, caps at 3", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 11 * MIN);

    expect(host.metadataUpdates).toHaveLength(1);
    expect(host.metadataUpdates[0]).toMatchObject({
      threadId: "th_1",
      set: { watchdog: "watching" },
    });

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]).toMatchObject({ threadId: "th_1", mode: "steer" });
    expect(inputText(host.sends[0])).toBe(`Idle Tool Nudge: ${DEFAULT_NUDGE_PROMPT}`);

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    vi.setSystemTime(T0 + 10 * MIN);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    vi.setSystemTime(T0 + 10 * MIN + 1);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);

    vi.setSystemTime(T0 + 20 * MIN + 2);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(3);

    vi.setSystemTime(T0 + 30 * MIN + 3);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(3);
  });

  it("falls back to stop + a start-mode send when steering fails", async () => {
    const host = freshHost();
    host.setSendImpl(async (args) => {
      if (args.mode === "steer") throw new Error("active-turn-not-steerable");
      host.sends.push(args);
      return {};
    });
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 11 * MIN);

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]).toMatchObject({ threadId: "th_1", mode: "start" });
    expect(inputText(host.sends[0])).toBe(`Idle Tool Nudge: ${DEFAULT_NUDGE_PROMPT}`);
    expect(host.stops).toHaveLength(1);
    expect(host.stops[0]).toMatchObject({ threadId: "th_1" });
  });

  it("skips the nudge when the item completed between the due check and the send", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 11 * MIN);
    host.eventLogs.get("th_1")!.push(
      completedRow("th_1", 2, toolCallItem("call_1", "completed"), T0),
    );

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);
    expect(host.stops).toHaveLength(0);
  });

  it("clears pending entries when the follower sees turn/completed", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 11 * MIN);
    host.eventLogs.get("th_1")!.push(turnCompletedRow("th_1", 2, T0));

    await vi.advanceTimersByTimeAsync(FOLLOWER_POLL_MS);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);
  });

  it("treats item/toolCall/progress as the call's own heartbeat", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 11 * MIN);
    host.eventLogs.get("th_1")!.push(progressRow("th_1", 2, "call_1", T0 - 30_000));

    await vi.advanceTimersByTimeAsync(FOLLOWER_POLL_MS);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);

    vi.setSystemTime(T0 - 30_000 + 10 * MIN + 1);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
  });

  it("tears down monitors on deleted/archived, drains on idle/failed, re-attaches on unarchived", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_del", "call_1", T0 - 11 * MIN);
    await attachHungThread(host, "th_arc", "call_2", T0 - 11 * MIN);
    await attachHungThread(host, "th_idl", "call_3", T0 - 11 * MIN);
    await attachHungThread(host, "th_err", "call_4", T0 - 11 * MIN);

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(4);

    await host.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "th_del", status: "idle" }),
    });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "th_arc", status: "idle" }),
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "th_idl", status: "idle" }),
      lastAssistantText: null,
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "th_err", status: "error" }),
      error: "boom",
    });

    vi.setSystemTime(T0 + 11 * MIN);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(4);

    await host.harness.behavior.emitThreadEvent("thread.unarchived", {
      thread: makeThreadResponse({ id: "th_arc", status: "idle" }),
    });
    expect(
      host.metadataUpdates.filter(
        (m: unknown) => (m as { threadId: string }).threadId === "th_arc",
      ),
    ).toHaveLength(2);

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(5);
    expect(host.sends[4]).toMatchObject({ threadId: "th_arc", mode: "steer" });
  });

  it("re-attaches running threads via the load-time scan, across reloads", async () => {
    const host = freshHost();
    host.setListRunning([{ id: "th_pre", hostId: "h_1" }]);
    await plugin(host.bb);
    expect(host.metadataUpdates).toHaveLength(1);
    expect(host.metadataUpdates[0]).toMatchObject({
      threadId: "th_pre",
      set: { watchdog: "watching" },
    });

    host.eventLogs.set("th_pre", [
      startedRow("th_pre", 1, toolCallItem("call_1", "pending"), T0 - 11 * MIN),
    ]);
    const reloaded = await host.harness.lifecycle.reload(plugin);
    expect(
      host.metadataUpdates.filter(
        (m: unknown) => (m as { threadId: string }).threadId === "th_pre",
      ),
    ).toHaveLength(2);

    await runSweep(reloaded.harness);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]).toMatchObject({ threadId: "th_pre", mode: "steer" });
  });

  it("picks up settings edits live and safe-degrades invalid values", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachHungThread(host, "th_1", "call_1", T0 - 90_000);

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);

    await host.harness.behavior.setSettings({ toolCallTimeoutMinutes: 1 });
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    await attachHungThread(host, "th_2", "call_2", T0 - 90_000);
    await host.harness.behavior.setSettings({ hungToolNudgePrompt: "Are you stuck?" });
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);
    expect(inputText(host.sends[1])).toBe("Idle Tool Nudge: Are you stuck?");

    await attachHungThread(host, "th_3", "call_3", T0 - 90_000);
    await host.harness.behavior.setSettings({ toolCallTimeoutMinutes: -5 });
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);
  });

  it("defines the v2 settings with the documented defaults", async () => {
    const host = freshHost();
    await plugin(host.bb);
    const d = host.harness.inspection.registrations.settingsDescriptors;
    expect(d.failedTurnRetriesEnabled).toMatchObject({ type: "boolean", default: true });
    expect(d.maxFailedTurnRetries).toMatchObject({ type: "number", default: 2 });
    expect(d.silentTurnMinutes).toMatchObject({ type: "number", default: 15 });
    expect(d.silentTurnPrompt).toMatchObject({ type: "string" });
    expect(d.approvalStallMinutes).toMatchObject({ type: "number", default: 10 });
    expect(d.contextPressureThresholdPct).toMatchObject({ type: "number", default: 85 });
    expect(d.loopRepeatCount).toMatchObject({ type: "number", default: 8 });
    expect(d.loopWindowMs).toMatchObject({ type: "number", default: 480000 });
  });
});

describe("bb-plugin-thread-cop v2 — failed-turn policy (F1+F6)", () => {
  it("escalates a permanent rejection: warns loudly, writes lastFailure metadata, never retries", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await emitTurnFailed(host, turnFailedPayload());

    expect(host.retries).toHaveLength(0);
    const failed = host.threadMetadata.get("th_1")!["v2"] as {
      lastFailure?: Record<string, unknown>;
    };
    expect(failed.lastFailure).toMatchObject({
      requestId: "req_1",
      attemptNumber: 1,
      category: "bad-request",
    });
    expect(
      host.harness.logEntries.some(
        (e) => e.level === "warn" && e.message.includes("FAILED TURN"),
      ),
    ).toBe(true);
  });

  it("reties a transient failure on the backoff ladder, capped at maxFailedTurnRetries", async () => {
    const host = freshHost();
    await plugin(host.bb);
    const transient = {
      category: "stream-disconnected" as const,
      httpStatusCode: null,
      providerCode: null,
    };
    await emitTurnFailed(
      host,
      turnFailedPayload({ errorInfo: transient, attemptNumber: 1, requestId: "req_1" }),
    );
    expect(host.retries).toHaveLength(1);
    expect(host.retries[0]).toMatchObject({
      threadId: "th_1",
      turnRequestId: "req_1",
      sendAt: T0 + 60_000,
    });
    expect(host.threadMetadata.get("th_1")!["v2"]).toMatchObject({
      retriedFor: "req_1",
    });

    await emitTurnFailed(
      host,
      turnFailedPayload({ errorInfo: transient, attemptNumber: 2, requestId: "req_2" }),
    );
    expect(host.retries).toHaveLength(2);
    expect(host.retries[1]).toMatchObject({ sendAt: T0 + 5 * MIN });

    // Attempt 3 is past the cap (1 + 2): escalate, not retry.
    await emitTurnFailed(
      host,
      turnFailedPayload({ errorInfo: transient, attemptNumber: 3, requestId: "req_3" }),
    );
    expect(host.retries).toHaveLength(2);
    expect(
      host.harness.logEntries.filter((e) => e.level === "warn" && e.message.includes("FAILED TURN")),
    ).toHaveLength(1);
  });

  it("retries unknown failures only when they look server-side", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await emitTurnFailed(
      host,
      turnFailedPayload({
        errorInfo: { category: "unknown", httpStatusCode: 502, providerCode: null },
      }),
    );
    expect(host.retries).toHaveLength(1);
    await emitTurnFailed(
      host,
      turnFailedPayload({
        threadId: "th_2",
        errorInfo: { category: "unknown", httpStatusCode: 400, providerCode: null },
      }),
    );
    expect(host.retries).toHaveLength(1);
  });

  it("stands down on a windowed rate limit (core already queued the verbatim retry)", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await emitTurnFailed(
      host,
      turnFailedPayload({
        errorInfo: {
          category: "rate-limit" as const,
          httpStatusCode: 429,
          providerCode: null,
        },
        rateLimits: {
          kind: "subscription-window" as const,
          overageReason: null,
          overageStatus: null,
          providerId: "p_1",
          reachedReason: null,
          status: "blocked" as const,
          windows: [
            { resetsAtMs: T0 + 5 * MIN, status: "blocked" as const, label: null, providerKey: null },
          ],
        },
      }),
    );
    expect(host.retries).toHaveLength(0);
    expect(host.threadMetadata.get("th_1")?.["v2"]).toBeUndefined();
  });

  it("stands down when a retry row is already queued for the thread", async () => {
    const host = freshHost();
    await plugin(host.bb);
    host.queuedRows.set("th_1", [{ id: "qm_1" }]);
    await emitTurnFailed(
      host,
      turnFailedPayload({
        errorInfo: {
          category: "stream-disconnected" as const,
          httpStatusCode: null,
          providerCode: null,
        },
      }),
    );
    expect(host.retries).toHaveLength(0);
  });

  it("never retries when the feature is disabled", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await host.harness.behavior.setSettings({ failedTurnRetriesEnabled: false });
    await emitTurnFailed(
      host,
      turnFailedPayload({
        errorInfo: {
          category: "stream-disconnected" as const,
          httpStatusCode: null,
          providerCode: null,
        },
      }),
    );
    expect(host.retries).toHaveLength(0);
  });

  it("guards against a reload double-retry via the retriedFor metadata key", async () => {
    const host = freshHost();
    await plugin(host.bb);
    const payload = turnFailedPayload({
      errorInfo: {
        category: "stream-disconnected" as const,
        httpStatusCode: null,
        providerCode: null,
      },
    });
    await emitTurnFailed(host, payload);
    expect(host.retries).toHaveLength(1);

    // A reload re-registers the listener; the same failure is announced again.
    const reloaded = await host.harness.lifecycle.reload(plugin);
    const emitted = await reloaded.harness.behavior.emitThreadEvent("turn.failed", payload);
    expect(emitted.errors).toEqual([]);
    expect(host.retries).toHaveLength(1);
  });
});

describe("bb-plugin-thread-cop v2 — silent-turn watchdog (F2)", () => {
  it("nudges a zero-event active turn once per window, escalates to stop+fresh, caps at 2", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachQuietThread(host, "th_1");

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0); // 15 min window not elapsed

    vi.setSystemTime(T0 + 15 * MIN + 1);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]).toMatchObject({ threadId: "th_1", mode: "steer" });
    expect(inputText(host.sends[0])).toContain("Silent Turn Nudge");

    // Still silent a full window later: escalation is stop + fresh turn.
    vi.setSystemTime(T0 + 30 * MIN + 2);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);
    expect(host.sends[1]).toMatchObject({ threadId: "th_1", mode: "start" });
    expect(host.stops).toHaveLength(1);

    // Cap reached: a third window sends nothing.
    vi.setSystemTime(T0 + 45 * MIN + 3);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);
  });

  it("skips the silence check while a pending interaction exists, resumes after it clears", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachQuietThread(host, "th_1");
    host.eventLogs.get("th_1")!.push(
      interactionRow("th_1", 1, "ix_1", "pending", T0 - 20 * MIN),
    );
    await advanceFollower();

    vi.setSystemTime(T0 + 20 * MIN);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);

    host.eventLogs.get("th_1")!.push(interactionRow("th_1", 2, "ix_1", "resolved", T0));
    await advanceFollower();
    vi.setSystemTime(T0 + 20 * MIN + 1);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
  });

  it("resumes the silence clock on any new event and clears the episode on turn/completed", async () => {
    const host = freshHost();
    await plugin(host.bb);
    await attachQuietThread(host, "th_1");

    vi.setSystemTime(T0 + 15 * MIN + 1);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    // An event arrives (e.g. a started item): the clock restarts.
    host.eventLogs.get("th_1")!.push(
      startedRow("th_1", 1, toolCallItem("call_1", "pending"), T0 + 15 * MIN),
    );
    await advanceFollower();
    vi.setSystemTime(T0 + 25 * MIN);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    vi.setSystemTime(T0 + 30 * MIN + 15_000);
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2); // no second nudge 5 min in, per the restart

    // turn/completed clears the episode: a later silence starts over at a steer.
    host.eventLogs.get("th_1")!.push(turnCompletedRow("th_1", 2, T0 + 31 * MIN));
    await advanceFollower();
    vi.setSystemTime(T0 + 46 * MIN + 1); // 15 min past the completed turn
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(3);
    expect(host.sends[2]).toMatchObject({ mode: "steer" });
  });
});

describe("bb-plugin-thread-cop v2 — approval-stall alert (F3)", () => {
  it("warns once per pending interaction past the stall window, logs again after an hour", async () => {
    const host = freshHost();
    await plugin(host.bb);
    host.eventLogs.set("th_1", [interactionRow("th_1", 1, "ix_1", "pending", T0 - 20 * MIN)]);
    await emitThreadCreated(host, "th_1");

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0); // F3 alerts only; no steer
    const warns = host.harness.logEntries.filter(
      (e) => e.level === "warn" && e.message.includes("APPROVAL STALL"),
    );
    expect(warns).toHaveLength(1);
    expect(host.threadMetadata.get("th_1")!["v2"]).toMatchObject({ approvalAlertAt: T0 });

    // Same sweep window again: no re-alert inside the hour.
    await runSweep(host.harness);
    expect(
      host.harness.logEntries.filter(
        (e) => e.level === "warn" && e.message.includes("APPROVAL STALL"),
      ),
    ).toHaveLength(1);

    // 61 minutes later: re-armed.
    vi.setSystemTime(T0 + 61 * MIN);
    await runSweep(host.harness);
    expect(
      host.harness.logEntries.filter(
        (e) => e.level === "warn" && e.message.includes("APPROVAL STALL"),
      ),
    ).toHaveLength(2);
  });

  it("clears the stall when the interaction resolves and does not alert again", async () => {
    const host = freshHost();
    await plugin(host.bb);
    host.eventLogs.set("th_1", [interactionRow("th_1", 1, "ix_1", "pending", T0 - 20 * MIN)]);
    await emitThreadCreated(host, "th_1");

    await runSweep(host.harness);
    expect(
      host.harness.logEntries.filter(
        (e) => e.level === "warn" && e.message.includes("APPROVAL STALL"),
      ),
    ).toHaveLength(1);

    host.eventLogs.get("th_1")!.push(interactionRow("th_1", 2, "ix_1", "resolved", T0));
    await advanceFollower();
    vi.setSystemTime(T0 + 90 * MIN);
    await runSweep(host.harness);
    expect(
      host.harness.logEntries.filter(
        (e) => e.level === "warn" && e.message.includes("APPROVAL STALL"),
      ),
    ).toHaveLength(1);
  });
});

describe("bb-plugin-thread-cop v2 — context-pressure nudge (F4)", () => {
  it("nudges once on crossing the threshold and re-arms after 15 points of headroom", async () => {
    const host = freshHost();
    await plugin(host.bb);
    host.eventLogs.set("th_1", [contextUsageRow("th_1", 1, 860_000, 1_000_000, T0 - MIN)]);
    await emitThreadCreated(host, "th_1");

    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);
    expect(inputText(host.sends[0])).toContain("Context Pressure Nudge");
    expect(host.threadMetadata.get("th_1")!["v2"]).toMatchObject({ contextAlertAt: T0 });

    // Still above threshold: no second nudge.
    host.eventLogs.get("th_1")!.push(contextUsageRow("th_1", 2, 900_000, 1_000_000, T0));
    await advanceFollower();
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    // Usage falls to 68% (below 85 − 15): re-arm.
    host.eventLogs.get("th_1")!.push(contextUsageRow("th_1", 3, 680_000, 1_000_000, T0));
    await advanceFollower();
    // Crossing again re-nudges.
    host.eventLogs.get("th_1")!.push(contextUsageRow("th_1", 4, 890_000, 1_000_000, T0));
    await advanceFollower();
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(2);
  });
});

describe("bb-plugin-thread-cop v2 — runaway-loop detector (F5)", () => {
  /** N identical completed runs of one command across started+completed pairs. */
  function pushLoopRuns(host: Host, threadId: string, count: number, fromSeq: number, fromMs: number, text = "npm test"): number {
    let seq = fromSeq;
    for (let i = 0; i < count; i++) {
      const log = host.eventLogs.get(threadId)!;
      const id = `cmd_${seq}`;
      log.push(commandStartedRow(threadId, seq++, id, "bash", fromMs + 2 * i));
      log.push(commandCompletedRow(threadId, seq++, id, text, fromMs + 2 * i + 1));
    }
    return seq;
  }

  it("steers once when the repeat count of one signature lands in the window, re-arms on a distinct signature", async () => {
    const host = freshHost();
    await plugin(host.bb);
    host.eventLogs.set("th_1", []);
    await emitThreadCreated(host, "th_1");
    pushLoopRuns(host, "th_1", 8, 1, T0 - MIN);
    await advanceFollower();
    await spin(() => host.sends.length >= 1, "loop steer");
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]).toMatchObject({ threadId: "th_1", mode: "steer" });
    expect(inputText(host.sends[0])).toContain("Runaway Loop Nudge");
    expect(inputText(host.sends[0])).toContain("npm test");

    // More of the same stays quiet (one alert per loop run).
    pushLoopRuns(host, "th_1", 8, 20, T0 + 100_000);
    await advanceFollower();
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(1);

    // A distinct signature interleaves, then the loop repeats: second alert.
    let seq = 44;
    host.eventLogs.get("th_1")!.push(
      commandCompletedRow("th_1", seq++, "cmd_x", "make all", T0 + 200_000),
    );
    pushLoopRuns(host, "th_1", 8, seq, T0 + 210_000);
    await advanceFollower();
    await spin(() => host.sends.length >= 2, "second loop steer");
    expect(host.sends).toHaveLength(2);
  });

  it("ignores coarse started-row commands (the shell binary) and never fires from history seeding", async () => {
    const host = freshHost();
    await plugin(host.bb);
    // History is full of an old loop before the plugin attaches.
    const history: AnyRow[] = [];
    for (let i = 1; i <= 8; i++) {
      history.push(commandCompletedRow("th_hist", i, `cmd_${i}`, "npm test", T0 - 3 * MIN + i));
    }
    host.eventLogs.set("th_hist", history);
    await emitThreadCreated(host, "th_hist");
    await advanceFollower();
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0); // seeding never feeds the buffer

    // Started rows differ only by the shell binary: not a signature.
    for (let i = 10; i < 24; i++) {
      host.eventLogs.get("th_hist")!.push(
        commandStartedRow("th_hist", i, `cmd_${i}`, "bash", T0 + i * 1000),
      );
    }
    await advanceFollower();
    await runSweep(host.harness);
    expect(host.sends).toHaveLength(0);

    // Live completed rows do accumulate: the 8th live run trips.
    pushLoopRuns(host, "th_hist", 8, 40, T0 + 100_000);
    await advanceFollower();
    await spin(() => host.sends.length >= 1, "live loop steer");
    expect(host.sends).toHaveLength(1);
    expect(inputText(host.sends[0])).toContain("Runaway Loop Nudge");
  });
});
