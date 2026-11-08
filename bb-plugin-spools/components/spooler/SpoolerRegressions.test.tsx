// Behavior regressions found during the deep plugin review.
import { createElement } from "react";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { KeyboardCoordinateGetter, KeyboardSensorOptions } from "@dnd-kit/core";
import type { PluginProvidersState } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeThread, makeProject, makeSection, NOW } from "./fixtures";
import { useThreadGroups } from "./useThreadGroups";
import { requestPaletteIntent } from "./paletteBus";
import { findLongPressTarget } from "./longPress";
import { clampMenuY } from "./SpoolerMenu";

const probes = vi.hoisted(() => ({
  rowRenders: 0,
  keyboardCoordinates: null as KeyboardCoordinateGetter | null,
  onDragStart: null as ((event: unknown) => void) | null,
  onDragEnd: null as ((event: unknown) => void) | null,
  /** Flip to make every useDroppable report `isOver` (drop-cue rendering). */
  isOver: false,
}));
vi.mock("@get-bb/plugin-sdk/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    useSidebarThreadDraft: (id: string) => {
      probes.rowRenders += 1;
      return actual.useSidebarThreadDraft(id);
    },
  };
});
vi.mock("@dnd-kit/core", async importOriginal => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useSensor: (...args: Parameters<typeof actual.useSensor>) => {
      if (args[0] === actual.KeyboardSensor) {
        probes.keyboardCoordinates = (args[1] as KeyboardSensorOptions).coordinateGetter ?? null;
      }
      return actual.useSensor(...args);
    },
    DndContext: (args: Parameters<typeof actual.DndContext>[0]) => {
      probes.onDragStart = args.onDragStart as ((event: unknown) => void) | undefined ?? null;
      probes.onDragEnd = args.onDragEnd as ((event: unknown) => void) | undefined ?? null;
      return createElement(actual.DndContext, args);
    },
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => {
      const result = actual.useDroppable(args);
      return probes.isOver ? { ...result, isOver: true } : result;
    },
  };
});

const app = await loadPluginApp(() => import("../../app"));
const list = app.threadLists[0]!;
const props = {
  activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false,
  onNavigate: () => {}, searchQuery: "",
};
const sdk: Record<string, unknown> = {
  threads: {
    defaultExecutionOptions: async () => null, context: async () => ({ usage: null }),
    update: async () => ({}), unarchive: async () => ({}), markRead: async () => ({}),
    archive: async () => ({}),
  },
  providers: { models: async () => ({ models: [] }) },
};
type MetaRowFixture = { threadId: string; metadata: { [key: string]: string | number | boolean } };
/** Spool membership lives on per-thread plugin metadata; feed the store. */
const spoolSdk = (
  metadata: MetaRowFixture[] = [],
  updatePluginMetadata: (...args: unknown[]) => Promise<MetaRowFixture["metadata"]> = async () => ({}),
) => ({
  ...sdk,
  threads: {
    ...(sdk.threads as object),
    experimental_listPluginMetadata: async () => ({ threads: metadata }),
    updatePluginMetadata,
  },
});
function mount(threads: PluginSidebarThread[], settings: Record<string, boolean> = {}) {
  return renderSlot(list, props, {
    sdk, settings, sidebarThreads: { status: "ready", threads,
      projects: [makeProject({ id: "proj_a" })], sections: [] },
  });
}
beforeAll(() => { Element.prototype.scrollIntoView = () => {};
  localStorage.setItem("spooler-sidebar:grouping:v1", "time"); });

/** The legacy `inspection.sidebarActionCalls` seam is gone at SDK 0.6.37:
 * archive now surfaces as `sdk.threads.archive` on `inspection.sdkCalls`. */
const archiveCalls = (slot: RenderedSlot) =>
  slot.inspection.sdkCalls
    .filter((call) => call.method === "threads.archive")
    .map((call) => ({
      method: "archive",
      threadId: (call.args[0] as { threadId: string }).threadId,
    }));
afterEach(() => { cleanup(); localStorage.clear();
  // regressions were captured under the legacy grouping; section default is
  // owned by SpoolerThreadList.test.tsx's grouping suite.
  localStorage.setItem("spooler-sidebar:grouping:v1", "time"); vi.restoreAllMocks(); vi.unstubAllGlobals();
  probes.rowRenders = 0; probes.keyboardCoordinates = null; probes.onDragStart = null; probes.onDragEnd = null; probes.isOver = false; });

describe("sidebar behavior regressions", () => {
  it("applies an adaptiveCollapse setting change to already mounted rows", async () => {
    const settings = { adaptiveCollapse: true };
    const slot = mount([makeThread({ id: "quiet" })], settings);
    await act(async () => {});
    expect(slot.container.querySelector(".spooler-row-collapsed")).not.toBeNull();
    settings.adaptiveCollapse = false;
    slot.rerender(createElement(list.component, { ...props, isCompactViewport: true }));
    expect(slot.container.querySelector(".spooler-row-collapsed")).toBeNull();
  });

  it("shows an approval-only group's attention pill instead of running", () => {
    const slot = mount([makeThread({ id: "waiting", indicator: "waiting-for-input",
      hasPendingInteraction: true, indicatorLabel: "Thread needs user input" })]);
    const needs = slot.container.querySelector(".spooler-group-pill-needs");
    expect(needs?.textContent).toContain("1 needs you");
    expect(slot.container.querySelector(".spooler-group-pill-working")).toBeNull();
  });

  it.each([
    { indicator: "unread-error" as const, isUnread: true },
    { indicator: "waiting-for-input" as const, hasPendingInteraction: true },
    { indicator: "runtime" as const, status: "active" as const },
  ])("excludes the parent from hidden-child status (%s)", (state) => {
    const slot = mount([
      makeThread({ id: "parent", ...state }),
      makeThread({ id: "child", parentThreadId: "parent" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    const parent = slot.container.querySelector('[data-sidebar-thread-id="parent"]')!;
    expect(parent.querySelector(".spooler-row-rollup .spooler-dot")).toBeNull();
  });

  it.each([
    ["waiting-for-input" as const, "needs you"],
    ["unread-error" as const, "failed"],
    ["queued-failed" as const, "failed"],
  ])("prioritizes a child's attention over a running parent (%s)", (indicator, expected) => {
    const slot = mount([
      makeThread({ id: "parent", status: "active", indicator: "runtime" }),
      makeThread({ id: "child", parentThreadId: "parent", indicator }),
    ]);
    expect(slot.container.querySelector(".spooler-group-pill-needs") !== null).toBe(
      expected === "needs you",
    );
    expect(slot.container.querySelector(".spooler-group-pill-failed") !== null).toBe(
      expected === "failed",
    );
  });

  it("prioritizes failed work over input waits and counts each descendant", () => {
    const threads = [makeThread({ id: "parent" }), ...["a", "b", "c"].flatMap((id) => [
      makeThread({ id: `wait-${id}`, parentThreadId: "parent", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: `fail-${id}`, parentThreadId: "parent", indicator: "queued-failed", queuedWork: "failed" }),
    ])];
    const hook = renderHook(() => useThreadGroups({ threads, query: "", statusFilter: "all",
      grouping: "time", projectOrder: [], projects: [], sections: [], now: NOW }));
    expect(hook.result.current.groups[0]).toMatchObject({ live: 0, needsUser: 3, failed: 3 });
    const slot = mount(threads);
    const failedPill = slot.container.querySelector(".spooler-group-pill-failed");
    expect(failedPill?.textContent).toContain("3 failed");
  });

  const openViewMenu = () => {
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
  };

  it.each(["family", "group"])("prunes selected children after folding their %s", (fold) => {
    const slot = mount([makeThread({ id: "parent" }), makeThread({ id: "child", parentThreadId: "parent" })]);
    fireEvent.click(slot.container.querySelector('[data-sidebar-thread-id="child"]')!, { ctrlKey: true });
    expect(screen.getByText("1 selected")).toBeTruthy();
    if (fold === "family") {
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse replies" }),
      );
    } else {
      openViewMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all folders" }));
    }
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("does not archive the last keyboard target after its group is folded", () => {
    const slot = mount([makeThread({ id: "hidden-target" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    openViewMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all folders" }));
    fireEvent.keyDown(document.body, { key: "e" });
    expect(archiveCalls(slot)).toEqual([]);
  });

  it.each(["arrows", "tab"])("returns %s focus to a visible parent when its child is folded", (focus) => {
    const slot = mount([makeThread({ id: "parent" }), makeThread({ id: "child", parentThreadId: "parent" })]);
    if (focus === "arrows") {
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
    } else act(() => { (slot.container.querySelector('[data-sidebar-thread-id="child"]') as HTMLElement).focus(); });
    expect(document.activeElement?.getAttribute("data-sidebar-thread-id")).toBe("child");
    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    expect(document.activeElement).toBe(slot.container.querySelector('[data-sidebar-thread-id="parent"]'));
  });

  it("leaves single-thread archive completion feedback to the host", () => {
    const success = vi.spyOn(toast, "success");
    const slot = mount([makeThread({ id: "archive" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "e" });
    expect(archiveCalls(slot)).toContainEqual({ method: "archive", threadId: "archive" });
    expect(success).not.toHaveBeenCalled();
  });

  it("does not announce bulk archive completion before the host confirms it", () => {
    const success = vi.spyOn(toast, "success");
    const slot = mount([makeThread({ id: "parent" }), makeThread({ id: "child", parentThreadId: "parent" })]);
    fireEvent.click(slot.container.querySelector('[data-sidebar-thread-id="parent"]')!, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    // The SDK harness records archive(), but does not archive anything or confirm.
    expect(archiveCalls(slot)).toContainEqual({ method: "archive", threadId: "parent" });
    expect(success).not.toHaveBeenCalled();
  });

  it("reuses unchanged provider rows when the list re-renders", async () => {
    const slot = renderSlot(list, props, {
      sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "pi-row" })],
        projects: [makeProject({ id: "proj_a" })], sections: [] },
      providers: { status: "ready", providers: [{ id: "pi", displayName: "Pi", logoUrl: null, icon: "Bot" }] as unknown as PluginProvidersState["providers"] },
    });
    await act(async () => {});
    const before = probes.rowRenders;
    slot.rerender(createElement(list.component, { ...props, searchQuery: "irrelevant-host-query" }));
    expect(probes.rowRenders).toBe(before);
  });

  it("counts every active descendant in the group status", () => {
    const threads = [makeThread({ id: "parent" }), ...["a", "b", "c"].map(id =>
      makeThread({ id, parentThreadId: "parent", status: "active", indicator: "runtime" }))];
    const hook = renderHook(() => useThreadGroups({ threads, query: "", statusFilter: "all",
      grouping: "time", projectOrder: [], projects: [], sections: [], now: NOW }));
    expect(hook.result.current.groups[0].live).toBe(3);
  });

  describe("thread row layout", () => {
  it("keeps the sub-head one line: provider name · time over the right side", () => {
    const slot = mount([makeThread({ id: "busy", title: "Busy thread", indicator: "runtime" })]);
    const row = slot.container.querySelector(".spooler-row") as HTMLElement;
    const head = row.querySelector(".spooler-row-head") as HTMLElement;
    expect(head.querySelector(".spooler-row-title")).not.toBeNull();
    // The sub-head carries the status word, the provider name and the short
    // time; the title line keeps only the title and the trailing chrome.
    const sub = row.querySelector(".spooler-row-sub") as HTMLElement;
    expect(sub).not.toBeNull();
    expect(sub.querySelector(".spooler-status-wording")?.textContent).toContain("Working");
    expect(sub.querySelector(".spooler-row-sub-prov")).not.toBeNull();
    expect(sub.querySelector(".spooler-row-time")).not.toBeNull();
    // The project rides the right-justified cluster, NOT the left.
    const left = sub.querySelector(".spooler-row-sub-left") as HTMLElement;
    expect(left.textContent).not.toContain("proj_a");
    const right = sub.querySelector(".spooler-row-sub-right") as HTMLElement;
    expect(right.textContent).toContain("proj_a");
    // No time on the title line any more; the ⋯ and chevron live there.
    expect(row.querySelector(".spooler-row-badges")?.querySelector(".spooler-row-time")).toBeNull();
    expect(row.querySelector(".spooler-row-badges")?.querySelector(".spooler-row-toggle")).not.toBeNull();
  });

  it("draws no person glyph on family children", () => {
    const slot = mount([
      makeThread({ id: "parent", title: "Parent" }),
      makeThread({ id: "kid", title: "Kid", parentThreadId: "parent" }),
    ]);
    expect(slot.container.querySelector(".spooler-row-child")).not.toBeNull();
    expect(slot.container.querySelector(".spooler-child-glyph")).toBeNull();
  });

  it("renders spool members as flat rows with no glyph", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", sectionId: "s1" }), makeThread({ id: "t2", sectionId: "s1" })],
        projects: [makeProject({ id: "proj_a" })], sections: [makeSection({ id: "s1", name: "Ideation" })] },
    });
    await act(async () => {});
    const members = slot.container.querySelectorAll(".spooler-spool-member .spooler-row");
    expect(members).toHaveLength(2);
    members.forEach((row) => expect(row.querySelector(".spooler-row-head")).not.toBeNull());
    expect(slot.container.querySelector(".spooler-child-glyph")).toBeNull();
  });
});

});

describe("section bucket layout", () => {
  it("floats threads above the spool deck in a section bucket", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
      sidebarThreads: {
        status: "ready",
        threads: [
          makeThread({ id: "t1", sectionId: "old" }),
          makeThread({ id: "t2", sectionId: "old" }),
          makeThread({ id: "t3", title: "Loose thread", sectionId: "old" }),
        ],
        projects: [makeProject({ id: "proj_a" })],
        sections: [makeSection({ id: "old", name: "Old" })],
      },
    });
    await act(async () => {});
    // The unfiled Inbox bucket leads the list; this deck lives in "Old".
    const fold = slot.container.querySelector(
      '.spooler-group[aria-label="Old"] > .spooler-fold > .spooler-fold-inner',
    );
    expect(fold).not.toBeNull();
    const cluster = fold!.querySelector(".spooler-thread-cluster");
    const deck = fold!.querySelector(".spooler-spool-slot");
    expect(cluster).not.toBeNull();
    expect(deck).not.toBeNull();
    // Threads first, spool deck beneath: the row cluster precedes the deck
    // in DOM order so the 2px rhythm reads threads → deck, every time.
    expect(
      cluster!.compareDocumentPosition(deck!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("palette commands drive the sidebar directly", () => {
  it("moving a spool member re-files the whole spool, skipping members already there", async () => {
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", sectionId: "old" }), makeThread({ id: "t2", sectionId: "sec-a" })],
        projects: [makeProject({ id: "proj_a" })],
        sections: [makeSection({ id: "sec-a", name: "Alpha Section" })] },
    });
    await act(async () => {});
    act(() => { requestPaletteIntent({ kind: "move-to-section", threadId: "t1" }); });
    const row = await screen.findByTestId("spooler-move-section:sec-a");
    act(() => { fireEvent.click(row); });
    await waitFor(() => expect(slot.inspection.sdkCalls).toContainEqual(
      { method: "threads.update", args: [{ threadId: "t1", sectionId: "sec-a" }] },
    ));
    // t2 already sits in sec-a — only the stale member moves.
    expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.update")).toHaveLength(1);
  });

  it("throwing onto a spool writes the membership metadata", async () => {
    const updatePluginMetadata = vi.fn(async () => ({}));
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: {} },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
      ], updatePluginMetadata),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1" }), makeThread({ id: "t2" })],
        projects: [makeProject({ id: "proj_a" })], sections: [] },
    });
    await act(async () => {});
    act(() => { requestPaletteIntent({ kind: "throw-onto-spool", threadId: "t1" }); });
    fireEvent.click(await screen.findByTestId("spooler-throw-spool:spool_a"));
    await waitFor(() => expect(updatePluginMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "t1",
        // pluginId is the runtime id (test-app default "test-plugin"); the
        // spool key landing on t1 is what this regression guards.
        set: expect.objectContaining({ spool: "spool_a" }),
      }),
    ));
    void slot;
  });

  it("rejects intents for threads that are not in the spools list", async () => {
    const error = vi.spyOn(toast, "error");
    mount([makeThread({ id: "here" })]);
    await act(async () => {});
    act(() => { requestPaletteIntent({ kind: "move-to-section", threadId: "ghost" }); });
    expect(error).toHaveBeenCalledWith("Thread isn't in the spools list.");
    expect(screen.queryByTestId("spooler-palette-overlay")).toBeNull();
  });
});


describe("press-and-hold targeting", () => {
  // Pure: the long-press timer only decides WHAT menu to open; these tests
  // pin the targeting rules. The timer itself runs on the list root.
  it("resolves a thread row from its link, a spool header from the card, members to threads", () => {
    const row = document.createElement("a");
    row.setAttribute("data-sidebar-thread-id", "t1");
    const inner = document.createElement("span");
    row.appendChild(inner);
    expect(findLongPressTarget(inner)).toEqual({ kind: "thread", threadId: "t1" });

    const spool = document.createElement("div");
    spool.setAttribute("data-spool-id", "spool_x");
    const title = document.createElement("span");
    spool.appendChild(title);
    expect(findLongPressTarget(title)).toEqual({ kind: "spool", spoolId: "spool_x" });
    // Member rows inside the card resolve to the thread, never the spool.
    const memberLink = document.createElement("a");
    memberLink.setAttribute("data-sidebar-thread-id", "m1");
    spool.appendChild(memberLink);
    expect(findLongPressTarget(memberLink)).toEqual({ kind: "thread", threadId: "m1" });
  });

  it("declines details panels, fields, and nothing-at-all", () => {
    const details = document.createElement("div");
    details.className = "spooler-row-details";
    const copy = document.createElement("button");
    details.appendChild(copy);
    expect(findLongPressTarget(copy)).toBeNull();

    expect(findLongPressTarget(document.createElement("input"))).toBeNull();
    const rename = document.createElement("div");
    rename.className = "spooler-rename";
    expect(findLongPressTarget(rename)).toBeNull();

    expect(findLongPressTarget(document.body)).toBeNull();
    expect(findLongPressTarget(null)).toBeNull();
  });
});

describe("context-menu vertical clamp", () => {
  // Pure: the menu sits at y only while it fits; otherwise the top shifts
  // upward, and a scrollbar arrives only when even that cannot fit.
  it("keeps y when the whole menu fits under it", () => {
    expect(clampMenuY(300, 200, 800)).toEqual({ top: 300, scrolls: false });
  });

  it("shifts the top upward when the menu would overflow the viewport", () => {
    // A 600px menu opened at y=500 in a 700px viewport would land its
    // bottom at 1100; the clamp parks it at 692 and scrolls nothing.
    expect(clampMenuY(500, 600, 700)).toEqual({ top: 92, scrolls: false });
  });

  it("scrolls internally only when the menu cannot fit the viewport at all", () => {
    expect(clampMenuY(500, 900, 700)).toEqual({ top: 8, scrolls: true });
  });

  it("caps at the margin with the scroll class when the top would go under", () => {
    // 700-−8−692 = 0: the top would land under the 8px margin, so the menu
    // parks at 8 and scrolls.
    expect(clampMenuY(600, 692, 700)).toEqual({ top: 8, scrolls: true });
  });
});
