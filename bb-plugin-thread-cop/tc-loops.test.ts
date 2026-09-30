import { describe, expect, it } from "vitest";
import {
  loopIsArmed,
  loopVerdict,
  markAlerted,
  normalizeCommand,
  noteObservedSignature,
  observeLoop,
  signatureOf,
  type LoopObservation,
} from "./tc-loops.js";

const T0 = 1_700_000_000_000;
const WINDOW = 480_000;
const REPEAT = 8;

function signature(buffer: LoopObservation[], i: number): string | undefined {
  return buffer[i]?.signature;
}

describe("signatureOf", () => {
  it("normalizes command text: collapses whitespace runs and trims", () => {
    expect(normalizeCommand("npm  test\n  --watch")).toBe("npm test --watch");
    expect(normalizeCommand("npm test")).toBe("npm test");
    expect(signatureOf({ kind: "command", command: "npm   test\n" })).toBe(
      "command:npm test",
    );
  });

  it("skips coarse command signatures: fewer than two meaningful tokens", () => {
    // bb's event-log started rows carry only the shell binary.
    expect(signatureOf({ kind: "command", command: "bash" })).toBeNull();
    expect(signatureOf({ kind: "command", command: "   \n" })).toBeNull();
    expect(signatureOf({ kind: "command", command: "zsh" })).toBeNull();
  });

  it("builds a tool signature from the tool name plus a compact input summary", () => {
    expect(signatureOf({ kind: "tool", name: "Bash", input: { command: "ls" } })).toBe(
      'tool:Bash({"command":"ls"})',
    );
    expect(signatureOf({ kind: "tool", name: "Read", input: "some long string input" })).toBe(
      "tool:Read(some long string input)",
    );
  });

  it("skips toolCall signatures the event log stripped (empty or {} input)", () => {
    expect(signatureOf({ kind: "tool", name: "Read" })).toBeNull();
    expect(signatureOf({ kind: "tool", name: "Read", input: undefined })).toBeNull();
    expect(signatureOf({ kind: "tool", name: "Read", input: null })).toBeNull();
    expect(signatureOf({ kind: "tool", name: "read", input: {} })).toBeNull();
    expect(signatureOf({ kind: "tool", name: "read", input: "" })).toBeNull();
  });
});

describe("observeLoop + loopVerdict", () => {
  it("trips when the repeat count lands within the window", () => {
    const buffer: LoopObservation[] = [];
    let tripped = false;
    let lastAlerted: string | null = null;
    for (let i = 0; i < REPEAT; i++) {
      observeLoop(buffer, "command:npm test", T0 + i * 1000, WINDOW);
      const verdict = loopVerdict(buffer, "command:npm test", T0 + i * 1000, WINDOW, REPEAT);
      expect(verdict.count).toBe(i + 1);
      if (verdict.tripped && loopIsArmed(lastAlerted, "command:npm test")) {
        tripped = true;
        lastAlerted = markAlerted(buffer, "command:npm test");
      }
    }
    expect(tripped).toBe(true);
    expect(signature(buffer, 0)).toBeUndefined();
  });

  it("does not trip on observations spread wider than windowMs", () => {
    const buffer: LoopObservation[] = [];
    for (let i = 0; i < REPEAT; i++) {
      observeLoop(buffer, "command:npm test", T0 + i * WINDOW, WINDOW);
      const verdict = loopVerdict(buffer, "command:npm test", T0 + i * WINDOW, WINDOW, REPEAT);
      expect(verdict.tripped).toBe(false);
    }
    expect(buffer).toHaveLength(1);
  });

  it("re-arms only after a distinct signature interleaves", () => {
    const buffer: LoopObservation[] = [];
    let lastAlerted: string | null = null;
    let alertCount = 0;

    const observe = (sig: string, at: number): void => {
      observeLoop(buffer, sig, at, WINDOW);
      if (verdictTrips(sig, at) && loopIsArmed(lastAlerted, sig)) {
        alertCount += 1;
        lastAlerted = markAlerted(buffer, sig);
      }
      lastAlerted = noteObservedSignature(lastAlerted, sig);
    };
    const verdictTrips = (sig: string, at: number): boolean =>
      loopVerdict(buffer, sig, at, WINDOW, REPEAT).tripped;

    for (let i = 0; i < REPEAT; i++) observe("command:npm test", T0 + i * 1000);
    expect(alertCount).toBe(1);

    // More of the same never re-alerts while lastAlerted matches.
    for (let i = REPEAT; i < 2 * REPEAT; i++) observe("command:npm test", T0 + i * 1000);
    expect(alertCount).toBe(1);

    // A distinct observation re-arms the detector.
    observe("command:make all", T0 + 2 * REPEAT * 1000);
    expect(lastAlerted).toBeNull();
    for (let i = 0; i < REPEAT; i++)
      observe("command:npm test", T0 + 2 * REPEAT * 1000 + 1000 + i * 1000);
    expect(alertCount).toBe(2);
  });

  it("does not re-alert from the tail of an already-tripped run", () => {
    const buffer: LoopObservation[] = [];
    let lastAlerted: string | null = null;
    let alertCount = 0;
    const observe = (sig: string, at: number): void => {
      observeLoop(buffer, sig, at, WINDOW);
      if (loopVerdict(buffer, sig, at, WINDOW, REPEAT).tripped && loopIsArmed(lastAlerted, sig)) {
        alertCount += 1;
        lastAlerted = markAlerted(buffer, sig);
      }
      lastAlerted = noteObservedSignature(lastAlerted, sig);
    };
    for (let i = 0; i < REPEAT + 4; i++) observe("tool:Task", T0 + i * 1000);
    expect(alertCount).toBe(1);
  });

  it("drops old observations so the buffer stays bounded", () => {
    const buffer: LoopObservation[] = [];
    for (let i = 0; i < 500; i++) {
      observeLoop(buffer, "command:loop", T0 + i * 60_000, WINDOW);
    }
    expect(buffer.length).toBeLessThanOrEqual(WINDOW / 60_000 + 1);
  });
});
