import { describe, expect, test } from "vitest";
import { withHistory } from "./store";
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

describe("withHistory", () => {
  test("prepends additions, newest first", () => {
    const current = [entry({ at: 100 })];
    const next = withHistory(current, [entry({ at: 200 })]);
    expect(next.map((row) => row.at)).toEqual([200, 100]);
  });

  test("exact replays collapse; a real flip-back stays", () => {
    const changed = entry({ at: 200 });
    const next = withHistory([], [changed, changed]);
    expect(next).toHaveLength(1);
    // 1.2.9 → 1.3.0, then back, then again: three records, each an
    // honest flip because their timestamps differ. Wait — a flip-back
    // appears as a *change* in the other direction, so it appears only
    // when the transition actually reversed.
    const flipBack = entry({ at: 300, from: "1.3.0", to: "1.2.9" });
    const flipForthAgain = entry({ at: 400 });
    const log = withHistory([flipForthAgain, flipBack, changed], [changed]);
    expect(log).toEqual([flipForthAgain, flipBack, changed]);
  });

  test("caps at 200 entries, keeping the newest", () => {
    // The log is stored newest-first, so build the fixture that way.
    const many = Array.from({ length: 260 }, (_, i) =>
      entry({ at: 259 - i, kind: "added", to: `1.0.${259 - i}`, from: null }),
    );
    const capped = withHistory(many, []);
    expect(capped).toHaveLength(200);
    expect(capped[0].at).toBe(259);
    expect(capped[capped.length - 1].at).toBe(60);
  });

  test("an unrelated tool's same-version record is distinct", () => {
    const pi = entry({ at: 100, tool: "pi" });
    const msb = entry({ at: 100, tool: "msb" });
    expect(withHistory([], [pi, msb, pi])).toHaveLength(2);
  });
});
