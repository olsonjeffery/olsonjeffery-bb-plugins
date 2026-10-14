import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  SWIPE_ACTION_OPTION_LABELS,
  shouldCommitSwipe,
  swipeActionFromSetting,
  swipeActionView,
  swipeOffset,
  swipeThreshold,
  SPRING_BACK,
  SPRING_OUT,
  springAtRest,
  stepSpring,
} from "./swipe";
import { looksLikeMomentumEnd } from "@/components/spooler/useRowSwipe";

const idle = { isUnread: false, isPinned: false, isArchived: false };

describe("swipe settings", () => {
  it("offers every action, with defaults among the options", () => {
    expect(SWIPE_ACTION_OPTION_LABELS).toContain(DEFAULT_SWIPE_RIGHT);
    expect(SWIPE_ACTION_OPTION_LABELS).toContain(DEFAULT_SWIPE_LEFT);
    expect(SWIPE_ACTION_OPTION_LABELS.map((label) => swipeActionFromSetting(label, "Nothing")))
      .toEqual(["read", "pin", "archive", "split", "rename", "menu", "delete", "none"]);
  });

  it.each([undefined, 3, "archive", ""])("falls back on an unknown value: %s", (value) => {
    expect(swipeActionFromSetting(value, "Pin / unpin")).toBe("pin");
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "does not read %s off the prototype chain",
    (value) => {
      expect(swipeActionFromSetting(value, "Pin / unpin")).toBe("pin");
    },
  );

  it("keeps the stored labels stable", () => {
    // Select options are stored as their text, so rewording one orphans every
    // saved choice. Change these only together with a migration.
    expect(SWIPE_ACTION_OPTION_LABELS).toEqual([
      "Mark read / unread",
      "Pin / unpin",
      "Archive / unarchive",
      "Open in split",
      "Rename",
      "More actions",
      "Delete…",
      "Nothing",
    ]);
  });
});

describe("swipeActionView", () => {
  it("names the toggle by what it will do", () => {
    expect(swipeActionView("read", { ...idle, isUnread: true })?.label).toBe("Read");
    expect(swipeActionView("read", idle)?.label).toBe("Unread");
    expect(swipeActionView("pin", { ...idle, isPinned: true })?.label).toBe("Unpin");
  });

  it("slides the row away only when it will leave the list", () => {
    expect(swipeActionView("archive", idle)?.removes).toBe(true);
    // The Archived tab loses a row on unarchive, just as Active does on archive.
    expect(swipeActionView("archive", { ...idle, isArchived: true })?.removes).toBe(true);
    // The All tab keeps it either way.
    expect(swipeActionView("archive", idle, false)?.removes).toBe(false);
    expect(swipeActionView("archive", { ...idle, isArchived: true }, false)?.removes)
      .toBe(false);
    // Delete waits on the host's confirmation.
    expect(swipeActionView("delete", idle)?.removes).toBe(false);
  });

  it("keeps a row that the host may ask to confirm archiving", () => {
    // Archiving a parent archives its children, behind a host dialog: folding
    // the row first would hide it from the very person being asked.
    expect(swipeActionView("archive", idle, true, true)?.removes).toBe(false);
    // Unarchiving asks nothing.
    expect(swipeActionView("archive", { ...idle, isArchived: true }, true, true)?.removes)
      .toBe(true);
  });

  it("has no view for none", () => {
    expect(swipeActionView("none", idle)).toBeNull();
  });
});

describe("gesture math", () => {
  it("arms at a third of the row within finger reach", () => {
    expect(swipeThreshold(300)).toBe(90);
    expect(swipeThreshold(100)).toBe(64);
    expect(swipeThreshold(1000)).toBe(128);
  });

  it("asks a trackpad for over half the row", () => {
    expect(swipeThreshold(300, "trackpad")).toBe(165);
    expect(swipeThreshold(150, "trackpad")).toBe(120);
    expect(swipeThreshold(1000, "trackpad")).toBe(240);
  });

  it("tracks the finger 1:1, then resists", () => {
    expect(swipeOffset(120, 300, true)).toBe(120);
    expect(swipeOffset(-120, 300, true)).toBe(-120);
    expect(swipeOffset(340, 300, true)).toBe(240 + 25);
  });

  it("only tugs on a side without an action", () => {
    expect(swipeOffset(50, 300, false)).toBe(10);
    expect(swipeOffset(-500, 300, false)).toBe(-28);
  });

  it("commits past the threshold unless pulled back hard", () => {
    expect(shouldCommitSwipe(100, 0, 90)).toBe(true);
    expect(shouldCommitSwipe(-100, 0, 90)).toBe(true);
    expect(shouldCommitSwipe(100, -1, 90)).toBe(false);
  });

  it("commits a short flick but not a short drag", () => {
    expect(shouldCommitSwipe(40, 0.8, 90)).toBe(true);
    expect(shouldCommitSwipe(-40, -0.8, 90)).toBe(true);
    expect(shouldCommitSwipe(40, 0.1, 90)).toBe(false);
    expect(shouldCommitSwipe(20, 2, 90)).toBe(false);
    expect(shouldCommitSwipe(0, 2, 90)).toBe(false);
  });
});

describe("springs", () => {
  const run = (
    x: number,
    velocity: number,
    target: number,
    spring: { stiffness: number; damping: number },
  ) => {
    let state = { x, velocity };
    let frames = 0;
    let peak = x;
    while (!springAtRest(state.x, state.velocity, target) && frames < 600) {
      state = stepSpring(state.x, state.velocity, target, 16.7, spring);
      peak = target === 0 ? Math.min(peak, state.x) : Math.max(peak, state.x);
      frames += 1;
    }
    return { frames, peak, x: state.x };
  };

  it("settles home in well under half a second with barely any overshoot", () => {
    const back = run(120, 0, 0, SPRING_BACK);
    expect(back.frames * 16.7).toBeLessThan(450);
    expect(back.peak).toBeGreaterThan(-6);
    expect(Math.abs(back.x)).toBeLessThan(0.5);
  });

  it("carries the finger's speed into the settle", () => {
    // Flung outward: it keeps going briefly before turning home.
    const step = stepSpring(100, 1.5, 0, 16.7, SPRING_BACK);
    expect(step.x).toBeGreaterThan(100);
  });

  it("slides out without bouncing", () => {
    const out = run(120, 1.2, 316, SPRING_OUT);
    expect(out.peak).toBeLessThan(316 + 1);
  });

  it("survives a long dropped frame", () => {
    const step = stepSpring(120, 0, 0, 1000, SPRING_BACK);
    expect(Number.isFinite(step.x)).toBe(true);
    expect(Math.abs(step.x)).toBeLessThan(120);
  });
});

describe("looksLikeMomentumEnd", () => {
  it("spots a flick fading out", () => {
    expect(looksLikeMomentumEnd([12, 9, 6, 4, 2.5, 1.6, 1.1])).toBe(true);
  });

  it("does not mistake an abrupt stop or a slow drag for a lift", () => {
    expect(looksLikeMomentumEnd([9, 9, 9, 9, 9])).toBe(false);
    expect(looksLikeMomentumEnd([1, 1, 0.8, 0.6, 0.5])).toBe(false);
    expect(looksLikeMomentumEnd([8, 6, 7, 3, 1])).toBe(false);
    expect(looksLikeMomentumEnd([4, 2, 1])).toBe(false);
  });
});
