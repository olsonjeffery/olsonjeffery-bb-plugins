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

async function render(threads: any[]) {
  const { useSpools } = await import("./useSpools");
  const client = sdk(); // stable reference — a fresh object per render would retrigger the fetch effect
  const utils = renderHook(
    () => useSpools({ threads, pluginId: "spools", sdk: client }),
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
    expect(first.set).toMatchObject({ spoolLead: true });
    expect(first.pluginId).toBe("spools");
    const second = fakeUpdate.mock.calls[1][0];
    expect(second.threadId).toBe("t2");
    expect(second.set).toMatchObject({ spoolLead: false });
    expect(second.set!!["spoolJoined"]).toBeGreaterThan(first.set["spoolJoined"]);
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
    localStorage.clear();
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
    localStorage.clear();
    localStorage.setItem("spooler-sidebar:add-position:v1", "top");
    fakeList.mockResolvedValue({ threads: [] });
    fakeUpdate.mockResolvedValue({});
    const utils = await render([t("t1"), t("t2", { parentThreadId: "t1" })]);
    await act(() => utils.result.current.throwOntoSpool("spool_a", "t1"));
    const joined = fakeUpdate.mock.calls.map((c: any[]) => c[0].set["spoolJoined"]);
    // Negative stamp sorts before every existing (positive) member; the
    // parent's +index family offsets still keep the parent above its children.
    expect(joined[0]).toBeLessThan(0);
    expect(joined[1]).toBeGreaterThan(joined[0]);
  });

  it("releaseThread migrates a custom title when the lead leaves", async () => {
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
      { threadId: "t2", set: { spoolTitle: "Fuzz" }, remove: undefined, pluginId: "spools" },
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
