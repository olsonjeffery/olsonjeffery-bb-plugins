import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread, makeProject, NOW, HOUR } from "./fixtures";
import { useThreadGroups } from "./useThreadGroups";

type Args = Parameters<typeof useThreadGroups>[0];
function argsFor(threads: Args["threads"]): Args {
  return { threads, query: "", statusFilter: "all", grouping: "time",
    projectOrder: [], projects: [makeProject({ id: "proj_a" })], sections: [], now: NOW };
}
afterEach(cleanup);

describe("family derivation cache", () => {
  it("shares activity and summary work across sorting, headers and row renders", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", latestAttentionAt: NOW });
    const activityRead = vi.fn(() => NOW);
    const unreadRead = vi.fn(() => false);
    Object.defineProperty(child, "latestAttentionAt", { get: activityRead });
    Object.defineProperty(child, "isUnread", { get: unreadRead });
    const args = argsFor([parent, child, makeThread({ id: "other" })]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const first = hook.result.current;
    const counts = first.countSubtree(parent);
    expect(first.subtreeActivity(parent)).toBe(NOW);
    activityRead.mockClear();
    unreadRead.mockClear();
    for (let i = 0; i < 100; i++) {
      expect(first.countSubtree(parent)).toBe(counts);
      expect(first.subtreeActivity(parent)).toBe(NOW);
    }
    hook.rerender({ ...args, grouping: "project" });
    expect(hook.result.current.countSubtree(parent)).toBe(counts);
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    expect(activityRead).not.toHaveBeenCalled();
    expect(unreadRead).not.toHaveBeenCalled();
  });

  it("invalidates summaries on a new snapshot and when filtering changes descendants", () => {
    const parent = makeThread({ id: "p", title: "Parentneedle" });
    const child = makeThread({ id: "c", parentThreadId: "p" });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const before = hook.result.current.countSubtree(parent);
    const failed = { ...child, isUnread: true, indicator: "unread-error" as const };
    const updated = { ...args, threads: [parent, failed] };
    hook.rerender(updated);
    const after = hook.result.current.countSubtree(parent);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ total: 2, unread: 1, failed: 1 });
    expect(hook.result.current.groups[0]).toMatchObject({ total: 2, unread: 1, failed: 1 });
    hook.rerender({ ...updated, query: "Parentneedle" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 1, unread: 0, failed: 0, kids: [] });
    hook.rerender({ ...updated, statusFilter: "unread" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 2, unread: 1, failed: 1 });
  });

  it("invalidates cached activity when the clock advances or live work ends", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - 3 * HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", status: "active", latestAttentionAt: NOW - HOUR });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    hook.rerender({ ...args, now: NOW + HOUR });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW + HOUR);
    hook.rerender({ ...args, threads: [parent, { ...child, status: "idle" }] });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW - HOUR);
    expect(hook.result.current.countSubtree(parent).live).toBe(0);
  });

  it("preserves all descendant counts and the first five previews in depth-first order", () => {
    const parent = makeThread({ id: "p" });
    const threads = [parent,
      makeThread({ id: "a", parentThreadId: "p", status: "active" }),
      makeThread({ id: "a1", parentThreadId: "a", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: "b", parentThreadId: "p", isUnread: true, indicator: "unread-error", latestAttentionAt: NOW - HOUR }),
      makeThread({ id: "c", parentThreadId: "p", isUnread: true, latestAttentionAt: NOW - 2 * HOUR }),
      makeThread({ id: "d", parentThreadId: "p", latestAttentionAt: NOW - 3 * HOUR }),
      makeThread({ id: "e", parentThreadId: "p", latestAttentionAt: NOW - 4 * HOUR }),
    ];
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    const counts = hook.result.current.countSubtree(parent);
    expect(counts).toMatchObject({ total: 7, unread: 2, live: 1, needsUser: 1, failed: 1 });
    expect(counts.kids.map(({ id, dot }) => [id, dot])).toEqual([
      ["a", "spooler-dot-running spooler-dot-pulse"], ["a1", "spooler-dot-attention"],
      ["b", "spooler-dot-error"], ["c", "spooler-unread"], ["d", null],
    ]);
  });

  it("preserves the traversal depth guard", () => {
    const threads = Array.from({ length: 32 }, (_, i) => makeThread({
      id: `t${i}`, parentThreadId: i === 0 ? null : `t${i - 1}`,
      latestAttentionAt: NOW - (40 - i) * HOUR,
    }));
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    expect(hook.result.current.countSubtree(threads[0]).total).toBe(27);
    expect(hook.result.current.subtreeActivity(threads[0])).toBe(threads[26].latestAttentionAt);
  });
});

describe("spool groups (section view only)", () => {
  const section = { id: "sec_1", name: "Work" } as never;
  type Args = Parameters<typeof useThreadGroups>[0];
  const argsWith = (threads: Args["threads"], extra: Partial<Args> = {}): Args => ({
    ...argsFor(threads),
    ...extra,
  });
  const argsForSection = (threads: Args["threads"], extra: Partial<Args> = {}): Args =>
    argsWith(threads, { grouping: "section", sections: [section], ...extra });

  it("anchors spool cards INSIDE their section, lifting members out of the bucket", () => {
    const lead = makeThread({ id: "l", title: "Top", sectionId: "sec_1" });
    const peer = makeThread({ id: "m", sectionId: "sec_1" });
    const lone = makeThread({ id: "x", sectionId: "sec_1" });
    const hook = renderHook(() => useThreadGroups(
      argsForSection([lead, peer, lone], {
        spools: [{ id: "spool_a", members: ["l", "m"], leadThreadId: "l", customTitle: null, title: "Spool: Top" }],
        spoolIdByThreadId: new Map([["l", "spool_a"], ["m", "spool_a"]]),
      }),
    ));
    const groups = hook.result.current.groups;
    // No standalone spool entry anymore: the card rides inside its section.
    expect(groups.map((g) => g.id)).toEqual(["section:sec_1", "section:__unfiled__"]);
    expect(groups[0].spools).toHaveLength(1);
    expect(groups[0].spools?.[0]).toMatchObject({
      id: "spool_a", label: "Spool: Top", leadThreadId: "l",
      members: [expect.objectContaining({ id: "l" }), expect.objectContaining({ id: "m" })],
    });
    // Members left the section bucket.
    expect(groups[0].roots.map((r) => r.id)).toEqual(["x"]);
  });

  it("counts members only and drops their filtered-out kin from the card", () => {
    const keep = makeThread({ id: "l", sectionId: "sec_1" });
    const child = makeThread({ id: "c", parentThreadId: "l", sectionId: "sec_1" });
    const failer = makeThread({ id: "f", parentThreadId: "l", sectionId: "sec_1", indicator: "unread-error", isUnread: true });
    const hook = renderHook(() => useThreadGroups(
      argsForSection([keep, child, failer], {
        spools: [{ id: "spool_a", members: ["l", "c", "f"], leadThreadId: "l", customTitle: null, title: "S" }],
        spoolIdByThreadId: new Map([["l", "spool_a"], ["c", "spool_a"], ["f", "spool_a"]]),
      }),
    ));
    const spoolGroup = hook.result.current.groups.find((g) => (g.spools?.length ?? 0) > 0);
    expect(spoolGroup?.spools?.[0]?.members.map((m) => m.id)).toEqual(["l", "c", "f"]);
    // Members only — parent l and child c are both counted once, not as a family.
    expect(spoolGroup?.total).toBe(3);
    expect(spoolGroup?.failed).toBe(1);
  });

  it("leaves members that are not spooled by the caller as ordinary rows", () => {
    const lead = makeThread({ id: "l", sectionId: "sec_1" });
    const member = makeThread({ id: "m", parentThreadId: "l", sectionId: "sec_1" });
    const hook = renderHook(() => useThreadGroups(
      argsForSection([lead, member], {
        spools: [{ id: "spool_a", members: ["x"], leadThreadId: "x", customTitle: null, title: "S" }],
        spoolIdByThreadId: new Map(),
      }),
    ));
    expect(hook.result.current.groups.map((g) => g.id)).toEqual(
      ["section:sec_1", "section:__unfiled__"],
    );
    expect(hook.result.current.shownChildren.get("l")?.map((t) => t.id)).toEqual(["m"]);
  });

  it("does not emit spool groups outside the section grouping", () => {
    const lead = makeThread({ id: "l" });
    const hook = renderHook(() => useThreadGroups(
      argsWith([lead], {
        spools: [{ id: "spool_a", members: ["l"], leadThreadId: "l", customTitle: null, title: "Spool: l" }],
        spoolIdByThreadId: new Map([["l", "spool_a"]]),
      }),
    ));
    expect(hook.result.current.groups.every((g) => g.spools === undefined)).toBe(true);
    expect(hook.result.current.groups.some((g) => g.id.startsWith("spool:"))).toBe(false);
  });
});

describe("Settled threads shelf", () => {
  const argsFor2 = (threads: Args["threads"], extra: Partial<Args> = {}): Args => ({
    ...argsFor(threads),
    ...extra,
  });

  it("sends recently archived threads to a Settled bucket that rides LAST", () => {
    const fresh = makeThread({
      id: "fresh",
      isArchived: true,
      archivedAt: NOW - HOUR,
    });
    const older = makeThread({
      id: "older",
      isArchived: true,
      archivedAt: NOW - 3 * HOUR,
    });
    const live = makeThread({ id: "live", latestAttentionAt: NOW - HOUR });
    const hook = renderHook(() => useThreadGroups(argsFor2([fresh, older, live])));
    const groups = hook.result.current.groups;
    expect(groups.map((g) => g.id)).toEqual(["time:today", "settled"]);
    const settled = groups[1];
    expect(settled.label).toBe("Settled threads");
    expect(settled.roots.map((r) => r.id)).toEqual(["fresh", "older"]);
    // Newest settle first on the shelf.
    expect(settled.roots[0]?.archivedAt).toBeGreaterThan(
      settled.roots[1]?.archivedAt ?? 0,
    );
    expect(hook.result.current.groups[0].roots.map((r) => r.id)).toEqual(["live"]);
  });

  it("is present in project and section groupings, always at the bottom", () => {
    const fresh = makeThread({
      id: "fresh",
      isArchived: true,
      archivedAt: NOW - HOUR,
    });
    const live = makeThread({ id: "live", sectionId: "sec_1" });
    const section = { id: "sec_1", name: "Work" } as never;
    const hook = renderHook(() =>
      useThreadGroups(
        argsFor2([fresh, live], {
          grouping: "section",
          sections: [section],
        }),
      ),
    );
    expect(hook.result.current.groups.map((g) => g.id)).toEqual([
      "section:sec_1",
      "section:__unfiled__",
      "settled",
    ]);

    const byProject = renderHook(() =>
      useThreadGroups(argsFor2([fresh, live], { grouping: "project" })),
    );
    expect(byProject.result.current.groups.map((g) => g.id)).toEqual([
      "project:proj_a",
      "settled",
    ]);
  });

  it("keeps a settled family together and skips rows the filter hides", () => {
    const parent = makeThread({
      id: "p",
      isArchived: true,
      archivedAt: NOW - HOUR,
    });
    const child = makeThread({
      id: "c",
      parentThreadId: "p",
      isArchived: true,
      archivedAt: NOW - 2 * HOUR,
    });
    const hook = renderHook(() => useThreadGroups(argsFor2([parent, child])));
    const settled = hook.result.current.groups.find((g) => g.id === "settled");
    // The child nests under its settled parent instead of spawning a second entry.
    expect(settled?.roots.map((r) => r.id)).toEqual(["p"]);
    expect(settled?.total).toBe(2);
  });

  it("ages threads off the shelf once the 24h window passes", () => {
    const aged = makeThread({
      id: "aged",
      isArchived: true,
      archivedAt: NOW - 25 * HOUR,
    });
    const hook = renderHook(() => useThreadGroups(argsFor2([aged])));
    // The shelf cut is on archivedAt only; the row's activity time still
    // drives which ordinary bucket it rides in.
    expect(hook.result.current.groups.map((g) => g.id)).toEqual([
      "time:yesterday",
    ]);
  });
});
