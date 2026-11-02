import { describe, expect, test } from "vitest";
import { HISTORY_RECENT_WINDOW_MS, pruneHistory } from "./prune";
import type { HistoryEntry } from "./snapshot";

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  at: 1000,
  hostId: "host_1",
  hostName: "Jeff's box",
  tool: "pi",
  kind: "changed",
  from: "1.2.9",
  to: "1.3.0",
  ...over,
});

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now" far from the epoch, offset to noon UTC so day-bucket
// arithmetic in the tests isn't sensitive to exact-midnight edges.
const NOW = 40 * DAY + 43_200_000;

describe("pruneHistory", () => {
  test("keeps everything inside the recent window", () => {
    const entries = [
      entry({ at: NOW - 1 }),
      entry({ at: NOW - 2 }),
      entry({ at: NOW - 3, tool: "msb" }),
    ];
    expect(pruneHistory(entries, { now: NOW })).toEqual(entries);
  });

  test("collapses older entries to one per machine per tool per day", () => {
    const sameDay = [
      entry({ at: NOW - DAY * 2 - 100, from: "1.0.0", to: "1.0.1" }),
      entry({ at: NOW - DAY * 2, from: "1.2.9", to: "1.3.0" }),
    ];
    const pruned = pruneHistory(sameDay, { now: NOW });
    expect(pruned).toHaveLength(1);
    expect(pruned[0].from).toBe("1.0.0"); // the day's newest change
  });

  test("machine and tool buckets are independent", () => {
    const entries = [
      entry({ at: NOW - DAY * 3, tool: "pi" }),
      entry({ at: NOW - DAY * 3, tool: "msb" }),
      entry({ at: NOW - DAY * 3, hostId: "host_2", hostName: "build-2" }),
    ];
    expect(pruneHistory(entries, { now: NOW })).toHaveLength(3);
  });

  test("different days stay distinct", () => {
    const entries = [entry({ at: NOW - DAY }), entry({ at: NOW - DAY * 2 })];
    expect(pruneHistory(entries, { now: NOW })).toHaveLength(2);
  });

  test("recent entries outrank older ones under the total cap", () => {
    const flood = Array.from({ length: 200 }, (_, i) => entry({ at: NOW - i - 1 }));
    const ancient = entry({ at: 0 });
    const pruned = pruneHistory([...flood, ancient], { now: NOW });
    expect(pruned).toHaveLength(200);
    expect(pruned.some((row) => row.at === 0)).toBe(false);
    expect(pruned[0].at).toBe(NOW - 1);
  });

  test("order stays newest-first", () => {
    const pruned = pruneHistory(
      [
        entry({ at: NOW - DAY * 5 - 5, from: "1.2.9", to: "1.3.0" }),
        entry({ at: NOW - DAY * 5 }),
        entry({ at: NOW - DAY * 30 }),
        entry({ at: NOW - 5 }),
      ],
      { now: NOW },
    );
    const ats = pruned.map((row) => row.at);
    expect(ats).toEqual([...ats].sort((a, b) => b - a));
  });

  test("the recent window constant is one day", () => {
    expect(HISTORY_RECENT_WINDOW_MS).toBe(86_400_000);
  });
});
