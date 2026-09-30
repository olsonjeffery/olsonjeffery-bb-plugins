import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

type SendCall = {
  threadId: string;
  mode: string;
  input: unknown[];
};

function newHost() {
  const eventLogs = new Map<string, AnyRow[]>();
  const sends: SendCall[] = [];
  const stops: unknown[] = [];
  const metadataUpdates: unknown[] = [];
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
});
