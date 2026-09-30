import { describe, expect, it } from "vitest";
import {
  clearThread,
  dueToolCalls,
  lastActivityAt,
  registerToolEnd,
  registerToolProgress,
  registerToolStart,
  shouldNudge,
} from "./tool-watch.js";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const TIMEOUT = 10 * MIN;

describe("registerToolStart", () => {
  it("is idempotent on itemId: keeps the first-seen tool and earliest startedAt", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolStart(entries, "th_1", {
      itemId: "call_1",
      tool: "OtherTool",
      startedAt: T0 - 5 * MIN,
      progressAt: T0,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ threadId: "th_1", itemId: "call_1", tool: "Task", startedAt: T0 - 5 * MIN });
    expect(entries[0].lastProgressAt).toBeNull();
  });

  it("keeps entries per thread: a second distinct call adds a second entry", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolStart(entries, "th_1", { itemId: "call_2", tool: "Bash", startedAt: T0 });
    registerToolStart(entries, "th_2", { itemId: "call_1", tool: "Task", startedAt: T0 });
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.itemId).sort()).toEqual(["call_1", "call_1", "call_2"]);
  });
});

describe("registerToolProgress", () => {
  it("updates lastProgressAt only for the matching thread + itemId", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolProgress(entries, "th_1", "call_2", T0 + MIN);
    expect(entries[0].lastProgressAt).toBeNull();
    registerToolProgress(entries, "th_2", "call_1", T0 + MIN);
    expect(entries[0].lastProgressAt).toBeNull();
    registerToolProgress(entries, "th_1", "call_1", T0 + MIN);
    expect(entries[0].lastProgressAt).toBe(T0 + MIN);
  });

  it("never moves lastProgressAt backwards", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolProgress(entries, "th_1", "call_1", T0 + 5 * MIN);
    registerToolProgress(entries, "th_1", "call_1", T0 + MIN);
    expect(entries[0].lastProgressAt).toBe(T0 + 5 * MIN);
  });
});

describe("registerToolEnd", () => {
  it("removes exactly the matching entry; unknown ids are a no-op", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolStart(entries, "th_1", { itemId: "call_2", tool: "Bash", startedAt: T0 });
    registerToolEnd(entries, "th_1", "call_missing");
    registerToolEnd(entries, "th_2", "call_1");
    expect(entries).toHaveLength(2);
    registerToolEnd(entries, "th_1", "call_1");
    expect(entries).toHaveLength(1);
    expect(entries[0].itemId).toBe("call_2");
  });
});

describe("dueToolCalls", () => {
  it("is not due at exactly the timeout and due one millisecond past it", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    expect(dueToolCalls(entries, T0 + TIMEOUT, TIMEOUT)).toHaveLength(0);
    expect(dueToolCalls(entries, T0 + TIMEOUT + 1, TIMEOUT)).toHaveLength(1);
  });

  it("keys the clock to the latest progress heartbeat, not the start", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolProgress(entries, "th_1", "call_1", T0 + 5 * MIN);
    expect(lastActivityAt(entries[0])).toBe(T0 + 5 * MIN);
    expect(dueToolCalls(entries, T0 + 14 * MIN, TIMEOUT)).toHaveLength(0);
    expect(dueToolCalls(entries, T0 + 15 * MIN + 1, TIMEOUT)).toHaveLength(1);
  });
});

describe("shouldNudge", () => {
  it("nudges once per hang, re-nudges only after another full window, caps at 3", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 - 11 * MIN });
    const [entry] = dueToolCalls(entries, T0, TIMEOUT);
    expect(entry).toBeDefined();
    expect(shouldNudge(entry, T0, TIMEOUT)).toBe(true);

    entry.nudgedAt.push(T0);
    expect(shouldNudge(entry, T0, TIMEOUT)).toBe(false);
    expect(shouldNudge(entry, T0 + TIMEOUT, TIMEOUT)).toBe(false);
    expect(shouldNudge(entry, T0 + TIMEOUT + 1, TIMEOUT)).toBe(true);

    entry.nudgedAt.push(T0 + TIMEOUT + 1);
    entry.nudgedAt.push(T0 + 2 * (TIMEOUT + 1));
    expect(shouldNudge(entry, T0 + 3 * (TIMEOUT + 1), TIMEOUT)).toBe(false);
  });
});

describe("clearThread", () => {
  it("empties that thread's entries and leaves others alone", () => {
    const entries: Parameters<typeof registerToolStart>[0] = [];
    registerToolStart(entries, "th_1", { itemId: "call_1", tool: "Task", startedAt: T0 });
    registerToolStart(entries, "th_1", { itemId: "call_2", tool: "Bash", startedAt: T0 });
    registerToolStart(entries, "th_2", { itemId: "call_3", tool: "Task", startedAt: T0 });
    clearThread(entries, "th_1");
    expect(entries).toHaveLength(1);
    expect(entries[0].threadId).toBe("th_2");
  });
});
