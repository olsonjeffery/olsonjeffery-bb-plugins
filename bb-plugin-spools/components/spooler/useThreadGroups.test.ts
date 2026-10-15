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

  it("lifts spool members out of section buckets into a card above their section", () => {
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
    expect(groups.map((g) => g.id)).toEqual(["spool:spool_a", "section:sec_1", "section:__unfiled__"]);
    expect(groups[0].spool).toMatchObject({
      id: "spool_a", label: "Spool: Top", leadThreadId: "l",
      members: [expect.objectContaining({ id: "l" }), expect.objectContaining({ id: "m" })],
    });
    // Members left the section bucket.
    expect(groups[1].roots.map((r) => r.id)).toEqual(["x"]);
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
    const spoolGroup = hook.result.current.groups[0];
    expect(spoolGroup.spool?.members.map((m) => m.id)).toEqual(["l", "c", "f"]);
    // Members only — parent l and child c are both counted once, not as a family.
    expect(spoolGroup.total).toBe(3);
    expect(spoolGroup.failed).toBe(1);
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
    expect(hook.result.current.groups.every((g) => g.spool === null)).toBe(true);
    expect(hook.result.current.groups.some((g) => g.id.startsWith("spool:"))).toBe(false);
  });
});
