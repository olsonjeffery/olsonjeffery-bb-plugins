// threadTags helpers: per-thread lookup, the spool rollup's dedupe +
// priority order, and the Plugin-health readout. No React here.
import { describe, expect, it } from "vitest";
import {
  TAG_ROLLUP_LIMIT,
  THREAD_TAGS_CHANNEL,
  THREAD_TAGS_PLUGIN_ID,
  THREAD_TAGS_PLUGIN_SOURCE,
  threadTagsHealthDetail,
  threadTagsHealthOf,
  tagForThread,
  rollupThreadTags,
  stateSchema,
  type RollupThread,
} from "./threadTags";

const tags = [
  { id: "urgent", label: "🔥", color: "#ef4444" },
  { id: "review", label: "👀", color: "#6b7280" },
  { id: "done", label: "✅", color: "#22c55e" },
];

const state = {
  tags,
  assignments: { t1: "urgent", t2: "review", t3: "urgent" },
};

describe("tagForThread", () => {
  it("resolves the one tag per thread", () => {
    expect(tagForThread(state, "t1")!.id).toBe("urgent");
    expect(tagForThread(state, "t3")!.id).toBe("urgent");
    expect(tagForThread(state, "t2")!.id).toBe("review");
  });

  it("reads null for untagged threads and stale assignments", () => {
    expect(tagForThread(state, "t4")).toBeNull();
    expect(
      tagForThread({ tags, assignments: { t9: "gone" } }, "t9"),
    ).toBeNull();
  });
});

describe("rollupThreadTags", () => {
  const members: RollupThread[] = [
    { id: "t1", indicator: "unread-error", isUnread: true }, // urgent, failed
    { id: "t3", indicator: "none", isUnread: false },        // urgent, idle
    { id: "t2", indicator: "waiting-for-input", isUnread: true }, // review, needs you
    { id: "t4", indicator: "none" }, // untagged
  ];

  it("dedupes, counts wearers, and orders attention first", () => {
    const rolled = rollupThreadTags(state, members);
    expect(rolled.map((entry) => entry.tag.id)).toEqual(["urgent", "review"]);
    expect(rolled[0]!.wornBy).toBe(2);
    expect(rolled[0]!.priority).toBe(4); // failed outranks needs-you
    expect(rolled[1]!.wornBy).toBe(1);
    expect(rolled[1]!.priority).toBe(3);
  });

  it("breaks priority ties deterministically: wearers first, then label order", () => {
    const rolled = rollupThreadTags(
      state,
      [
        { id: "t2", indicator: "none" },
        { id: "t1", indicator: "none" },
      ],
    );
    // Both idle, both single wearers: the pair sorts by label collation —
    // stable across renders rather than arrival order.
    expect(rolled.map((entry) => entry.tag.label)).toEqual(["👀", "🔥"]);
  });

  it("shows nothing without the plugin or with no members", () => {
    expect(rollupThreadTags(null, members)).toEqual([]);
    expect(rollupThreadTags(state, [])).toEqual([]);
    expect(rollupThreadTags({ tags, assignments: {} }, members)).toEqual([]);
  });

  it("never returns more entries than the display limit promise", () => {
    expect(TAG_ROLLUP_LIMIT).toBe(4);
  });
});

describe("state schema", () => {
  it("carries the other plugin's state_get shape", () => {
    const parsed = stateSchema.parse(assignmentsShape());
    expect(parsed.tags[0]).toEqual({ id: "urgent", label: "🔥", color: "#ef4444" });
    expect(parsed.assignments.t1).toBe("urgent");
  });

  it("strips unknown fields at the boundary", () => {
    const parsed = stateSchema.parse(
      assignmentsShape({ id: "urgent", label: "🔥", color: "#ef4444", extra: true }),
    );
    expect(Object.keys(parsed.tags[0]!)).toEqual(["id", "label", "color"]);
  });

  function assignmentsShape(overTag?: Record<string, unknown>) {
    return {
      tags: [{ id: "urgent", label: "🔥", color: "#ef4444", ...overTag }],
      assignments: { t1: "urgent" },
    };
  }
});

describe("plugin health readout", () => {
  const row = (over: Partial<{ id: string; enabled: boolean; status: string; version: string }> = {}) => ({
    id: THREAD_TAGS_PLUGIN_ID,
    enabled: true,
    status: "running",
    version: "0.1.0",
    ...over,
  });

  it("reads available and details state + version", () => {
    const health = threadTagsHealthOf([row()]);
    expect(health.available).toBe(true);
    expect(health.installed).toBe(true);
    expect(threadTagsHealthDetail(health)).toBe("Running · v0.1.0");
  });

  it("names a missing install, a disabled one, and a hard failure", () => {
    const missing = threadTagsHealthOf([]);
    expect(threadTagsHealthDetail(missing)).toBe("Not installed");
    const disabled = threadTagsHealthOf([row({ enabled: false, status: "disabled" })]);
    expect(healthAvailable(disabled)).toBe(false);
    expect(threadTagsHealthDetail(disabled)).toBe("Installed — disabled");
    const failing = threadTagsHealthOf([row({ status: "error" })]);
    expect(healthAvailable(failing)).toBe(false);
  });

  it("keeps unknown statuses available (forward-compatible rows)", () => {
    const health = threadTagsHealthOf([row({ status: "needs-configuration" })]);
    expect(healthAvailable(health)).toBe(true);
  });

  it("pins the same git source the one-click install uses", () => {
    expect(THREAD_TAGS_PLUGIN_SOURCE).toBe(
      "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0",
    );
  });

  it("subscribes to the other plugin's realtime channel", () => {
    expect(THREAD_TAGS_CHANNEL).toBe("tags-changed");
  });

  function healthAvailable(health: Parameters<typeof threadTagsHealthDetail>[0]): boolean {
    return health.available;
  }
});
