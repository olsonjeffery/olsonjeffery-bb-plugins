// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeList, fakeUpdate } = vi.hoisted(() => ({
  fakeList: vi.fn(),
  fakeUpdate: vi.fn(),
}));

var makeThread: (fixture: any) => any;
beforeEach(async () => {
  fakeList.mockReset();
  fakeUpdate.mockReset();
  ({ makeThread: makeThread } = await import("./fixtures"));
});

function sdk(): any {
  return { threads: { experimental_listPluginMetadata: fakeList, updatePluginMetadata: fakeUpdate } };
}

/* every fetch returns these rows (metadata = pluginId="spools" row) */
const metaRow = (threadId: string, metadata: Record<string, unknown>) => ({ threadId, metadata });

async function render(threads: any[], addPosition?: "bottom" | "top") {
  const { useSpools } = await import("./useSpools");
  const client = sdk(); // stable reference — a fresh object per render would retrigger the fetch effect
  const utils = renderHook(
    () => useSpools({ threads, pluginId: "spools", sdk: client, addPosition }),
  );
  await waitFor(() => expect(utils.result.current.status).toBe("ready"));
  return utils;
}

const empty = () => [];

const t = (id: string, overrides: Record<string, unknown> = {}) =>
  makeThread({ id, ...overrides });

describe("useSpools reads", () => {
  it("fetches metadata in chunks of ≤200 and folds into spools", async () => {
    fakeList.mockImplementation(async ({ threadIds }: any) => ({
      threads: threadIds
        .filter((id: string) => id === "t1" || id === "t2")
        .map((id: string) =>
          metaRow(id, id === "t1"
            ? { spool: "spool_a", spoolJoined: 10, spoolLead: true }
            : { spool: "spool_a", spoolJoined: 20 }),
        ),
    }));
    const utils = await render([t("t1", { title: "Alpha" }), t("t2", { title: "Beta" }), t("t3")]);
    expect(fakeList).toHaveBeenCalledTimes(1);
    const { spools, spoolFor, membershipFor } = utils.result.current;
    expect(spools).toHaveLength(1);
    expect(spools[0].members).toEqual(["t1", "t2"]);
    expect(spools[0].title).toBe("Spool: Alpha");
    expect(spoolFor("t3")).toBeNull();
    expect(membershipFor("t1")).toEqual({ id: "spool_a", joined: 10, lead: true });
  });

  it("does not refetch when ids are unchanged", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    const client = sdk();
    const threads = [t("t1"), t("t2")];
    const { useSpools } = await import("./useSpools");
    const utils = renderHook(() => useSpools({ threads: [...threads], pluginId: "spools", sdk: client }));
    await waitFor(() => expect(utils.result.current.status).toBe("ready"));
    const reread = { ...t("t1"), updatedAt: 999 };
    utils.rerender({ threads: [reread, t("t2")], pluginId: "spools", sdk: client });
    await waitFor(() => expect(fakeList).toHaveBeenCalledTimes(1));
  });
});

describe("useSpools writes", () => {
  it("createSpoolFromThread writes the whole family with lead on the root", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1", { title: "Root" }), t("t2", { parentThreadId: "t1" }), t("t3")]);
    await act(() => utils.result.current.createSpoolFromThread("t1"));
    expect(fakeUpdate).toHaveBeenCalledTimes(2);
    const first = fakeUpdate.mock.calls[0][0];
    expect(first.threadId).toBe("t1");
    // Named once, at creation: the lead's current title is frozen, so later
    // adds can never retitle the spool.
    expect(first.set).toMatchObject({ spoolLead: true, spoolTitle: "Spool: Root" });
    expect(first.pluginId).toBe("spools");
    const second = fakeUpdate.mock.calls[1][0];
    expect(second.threadId).toBe("t2");
    expect(second.set).toMatchObject({ spoolLead: false });
    expect(second.remove).toEqual(["spoolTitle"]);
    expect(second.set!!["spoolJoined"]).toBeGreaterThan(first.set["spoolJoined"]);
  });

  it("createSpoolFromThread freezes a user-supplied custom title", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1", { title: "Root" })]);
    await act(() => utils.result.current.createSpoolFromThread("t1", { customTitle: "Sprint" }));
    expect(fakeUpdate.mock.calls[0][0].set).toMatchObject({ spoolTitle: "Sprint" });
    expect(fakeUpdate.mock.calls[0][0].remove).toBeUndefined();
  });

  it("throwOntoSpool reconciles a derived title + elected lead ONCE, before the join", async () => {
    // The existing spool carries no spoolTitle (pre-freeze install) and its
    // lead marker is gone (elected) — the arrival must neither rename the
    // card nor re-elect: one reconciliation write fixes both holes first.
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 10 }),
        metaRow("t2", { spool: "spool_a", spoolJoined: 20 }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1", { title: "Alpha" }), t("t2", { title: "Beta" }), t("t3")]);
    await act(() => utils.result.current.throwOntoSpool("spool_a", "t3"));
    const calls = fakeUpdate.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([
      // Reconcile: freeze the CURRENT derived title, persist the elected lead.
      { threadId: "t1", set: { spoolLead: true, spoolTitle: "Spool: Alpha" }, remove: undefined, pluginId: "spools" },
      // The arrival joins last (bottom default) and stays title-less.
      {
        threadId: "t3",
        set: { spool: "spool_a", spoolJoined: expect.any(Number), spoolLead: false },
        remove: ["spoolTitle"],
        pluginId: "spools",
      },
    ]);
  });

  it("throwOntoSpool writes nothing extra onto an already-frozen spool", async () => {
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 10, spoolLead: true, spoolTitle: "Named" }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1", { title: "Alpha" }), t("t2")]);
    await act(() => utils.result.current.throwOntoSpool("spool_a", "t2"));
    const calls = fakeUpdate.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].threadId).toBe("t2");
  });

  it("throwOntoSpool breaks out of the old spool then joins the new", async () => {
    fakeList.mockResolvedValue({
      threads: [metaRow("t1", { spool: "spool_old", spoolJoined: 5, spoolLead: true })],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2")]);
    await act(() => utils.result.current.throwOntoSpool("spool_new", "t1"));
    const calls = fakeUpdate.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      threadId: "t1",
      set: { spool: "spool_new", spoolJoined: expect.any(Number), spoolLead: false },
      remove: ["spoolTitle"],
    });
    expect(calls[0].pluginId).toBe("spools");
  });

  it("throwOntoSpool queues the family at the bottom by default", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2", { parentThreadId: "t1" })]);
    await act(() => utils.result.current.throwOntoSpool("spool_a", "t1"));
    const joined = fakeUpdate.mock.calls.map((c: any[]) => c[0].set["spoolJoined"]);
    expect(joined[0]).toBeGreaterThan(0);
    // Family members jump just behind the parent, in family order.
    expect(joined[1]).toBeGreaterThan(joined[0]);
  });

  it("throwOntoSpool stacks the family on top when add-to-top is set", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render(
      [t("t1"), t("t2", { parentThreadId: "t1" })],
      "top",
    );
    await act(() => utils.result.current.throwOntoSpool("spool_a", "t1"));
    const joined = fakeUpdate.mock.calls.map((c: any[]) => c[0].set["spoolJoined"]);
    // Negative stamp sorts before every existing (positive) member; the
    // parent's +index family offsets still keep the parent above its children.
    expect(joined[0]).toBeLessThan(0);
    expect(joined[1]).toBeGreaterThan(joined[0]);
  });

  it("releaseThread migrates the title AND the real lead when the lead leaves", async () => {
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 5, spoolLead: true, spoolTitle: "Fuzz" }),
        metaRow("t2", { spool: "spool_a", spoolJoined: 6 }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2")]);
    expect(utils.result.current.spools[0].customTitle).toBe("Fuzz");
    await act(() => utils.result.current.releaseThread("t1"));
    const calls = fakeUpdate.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([
      { threadId: "t1", set: undefined, remove: ["spool", "spoolJoined", "spoolLead", "spoolTitle"], pluginId: "spools" },
      // The promoted member now really carries spoolLead, so a later add's
      // join stamp can never re-elect a different lead underneath the card.
      { threadId: "t2", set: { spoolTitle: "Fuzz", spoolLead: true }, remove: undefined, pluginId: "spools" },
    ]);
  });

  it("releaseThread elects a member whose family is NOT also leaving", async () => {
    // The lead's child leaves together with it; the child must not be
    // promoted (its title migration would land on a thread that just left).
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 5, spoolLead: true, spoolTitle: "Fuzz" }),
        metaRow("t2", { spool: "spool_a", spoolJoined: 6 }),
        metaRow("t3", { spool: "spool_a", spoolJoined: 7 }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2", { parentThreadId: "t1" }), t("t3")]);
    await act(() => utils.result.current.releaseThread("t1"));
    const calls = fakeUpdate.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([
      { threadId: "t1", set: undefined, remove: ["spool", "spoolJoined", "spoolLead", "spoolTitle"], pluginId: "spools" },
      { threadId: "t2", set: undefined, remove: ["spool", "spoolJoined", "spoolLead", "spoolTitle"], pluginId: "spools" },
      { threadId: "t3", set: { spoolTitle: "Fuzz", spoolLead: true }, remove: undefined, pluginId: "spools" },
    ]);
  });

  it("unspool releases every member", async () => {
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 5, spoolLead: true }),
        metaRow("t2", { spool: "spool_a", spoolJoined: 6 }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2"), t("t3")]);
    expect(utils.result.current.spools).toHaveLength(1);
    await act(() => utils.result.current.unspool("spool_a"));
    expect(fakeUpdate).toHaveBeenCalledTimes(2);
    for (const call of fakeUpdate.mock.calls) {
      expect(call[0].remove).toEqual(["spool", "spoolJoined", "spoolLead", "spoolTitle"]);
    }
  });

  it("renameSpool writes spoolTitle to the lead thread", async () => {
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 5, spoolLead: true }),
        metaRow("t2", { spool: "spool_a", spoolJoined: 6 }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2")]);
    await act(() => utils.result.current.renameSpool("spool_a", "My name"));
    expect(fakeUpdate).toHaveBeenCalledWith({
      threadId: "t1",
      set: { spoolTitle: "My name" },
      remove: undefined,
      pluginId: "spools",
    });
    expect(fakeUpdate).toHaveBeenCalledTimes(1);
  });

  it("clearing a rename re-freezes the derived title instead of restoring derivation", async () => {
    fakeList.mockResolvedValue({
      threads: [
        metaRow("t1", { spool: "spool_a", spoolJoined: 5, spoolLead: true, spoolTitle: "Fuzz" }),
      ],
    });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1", { title: "Alpha" })]);
    await act(() => utils.result.current.renameSpool("spool_a", "  "));
    expect(fakeUpdate).toHaveBeenCalledTimes(1);
    expect(fakeUpdate.mock.calls[0][0]).toMatchObject({
      threadId: "t1",
      // The value shown at clear-time becomes the permanent frozen title.
      set: { spoolTitle: "Spool: Alpha" },
    });
  });

  it("mutations refetch metadata after writes", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1")]);
    const before = fakeList.mock.calls.length;
    await act(() => utils.result.current.createSpoolFromThread("t1"));
    await waitFor(() => expect(fakeList.mock.calls.length).toBeGreaterThan(before));
  });

  it("tolerates write failures and still refetches", async () => {
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockRejectedValue(new Error("offline"));
    const utils = await render([t("t1")]);
    const before = fakeList.mock.calls.length;
    await act(() => utils.result.current.createSpoolFromThread("t1"));
    await waitFor(() => expect(fakeList.mock.calls.length).toBeGreaterThan(before));
  });
});
