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

  it("shows an approval-only group's attention state instead of running", () => {
    const slot = mount([makeThread({ id: "waiting", indicator: "waiting-for-input",
      hasPendingInteraction: true, indicatorLabel: "Thread needs user input" })]);
    const status = slot.container.querySelector(".spooler-group-status");
    expect(status?.getAttribute("aria-label")).toBe("1 waiting for input");
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
    expect(parent.querySelector(".spooler-kids-pill .spooler-dot")).toBeNull();
  });

  it.each([
    ["waiting-for-input" as const, "1 waiting for input"],
    ["unread-error" as const, "1 failed"],
    ["queued-failed" as const, "1 failed"],
  ])("prioritizes a child's attention over a running parent (%s)", (indicator, expected) => {
    const slot = mount([
      makeThread({ id: "parent", status: "active", indicator: "runtime" }),
      makeThread({ id: "child", parentThreadId: "parent", indicator }),
    ]);
    expect(slot.container.querySelector(".spooler-group-status")?.getAttribute("aria-label")).toBe(expected);
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
    expect(slot.container.querySelector(".spooler-group-status")?.getAttribute("aria-label")).toBe("3 failed");
  });

  it.each(["family", "group"])("prunes selected children after folding their %s", (fold) => {
    const slot = mount([makeThread({ id: "parent" }), makeThread({ id: "child", parentThreadId: "parent" })]);
    fireEvent.click(slot.container.querySelector('[data-sidebar-thread-id="child"]')!, { ctrlKey: true });
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: fold === "family" ? "Collapse replies" : "Collapse all folders" }));
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("does not archive the last keyboard target after its group is folded", () => {
    const slot = mount([makeThread({ id: "hidden-target" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));
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

  it("moves the whole selection when its grip is dropped onto a section", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "a" }), makeThread({ id: "b" })],
        projects: [makeProject({ id: "proj_a" })], sections: [makeSection({ id: "dest", name: "Destination" })] },
    });
    for (const id of ["a", "b"]) fireEvent.click(slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`)!, { ctrlKey: true });
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(probes.onDragEnd).not.toBeNull();
    act(() => { probes.onDragStart!({ active: { data: { current: { threadId: "a" } } } }); });
    await act(async () => { probes.onDragEnd!({
      active: { data: { current: { threadId: "a" } } },
      over: { data: { current: { sectionId: "dest" } } },
    }); });
    const moved = slot.inspection.sdkCalls.filter(call => call.method === "threads.update");
    expect(moved.map(call => (call.args[0] as { threadId: string }).threadId).sort()).toEqual(["a", "b"]);
  });

  it("reports partial section move failures after every selected update settles", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const success = vi.spyOn(toast, "success");
    const error = vi.spyOn(toast, "error");
    const slot = renderSlot(list, props, {
      sdk: { ...sdk, threads: { ...(sdk.threads as object), update: async ({ threadId }: { threadId: string }) => {
        if (threadId === "b") throw new Error("Host refused the update");
        return makeThreadResponse({ id: threadId });
      } } },
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "a" }), makeThread({ id: "b" })],
        projects: [makeProject({ id: "proj_a" })], sections: [makeSection({ id: "dest", name: "Destination" })] },
    });
    for (const id of ["a", "b"]) fireEvent.click(slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`)!, { ctrlKey: true });
    act(() => { probes.onDragStart!({ active: { data: { current: { threadId: "a" } } } }); });
    await act(async () => { probes.onDragEnd!({
      active: { data: { current: { threadId: "a" } } }, over: { data: { current: { sectionId: "dest" } } },
    }); });
    expect(success).toHaveBeenCalledWith("Moved 1 thread to Destination");
    expect(error).toHaveBeenCalledWith("Couldn’t move 1 thread to Destination.");
  });

  it("moves only the dragged thread when its grip is outside the selection", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "a" }), makeThread({ id: "b" })],
        projects: [makeProject({ id: "proj_a" })], sections: [makeSection({ id: "dest", name: "Destination" })] },
    });
    fireEvent.click(slot.container.querySelector('[data-sidebar-thread-id="b"]')!, { ctrlKey: true });
    act(() => { probes.onDragStart!({ active: { data: { current: { threadId: "a" } } } }); });
    await act(async () => { probes.onDragEnd!({
      active: { data: { current: { threadId: "a" } } }, over: { data: { current: { sectionId: "dest" } } },
    }); });
    expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.update")).toEqual([
      { method: "threads.update", args: [{ threadId: "a", sectionId: "dest" }] },
    ]);
  });

  it.each(["more", "context"])("closes the preview before opening the row action menu (%s)", async (trigger) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const slot = mount([makeThread({ id: "hover" })]);
    fireEvent.mouseEnter(slot.container.querySelector(".spooler-row")!);
    await screen.findByRole("dialog");
    if (trigger === "more") fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    else fireEvent.contextMenu(slot.container.querySelector('[data-sidebar-thread-id="hover"]')!);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels a pending preview when the row menu opens", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const slot = mount([makeThread({ id: "hover" })]);
    fireEvent.mouseEnter(slot.container.querySelector(".spooler-row")!);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("counts every active descendant in the group status", () => {
    const threads = [makeThread({ id: "parent" }), ...["a", "b", "c"].map(id =>
      makeThread({ id, parentThreadId: "parent", status: "active", indicator: "runtime" }))];
    const hook = renderHook(() => useThreadGroups({ threads, query: "", statusFilter: "all",
      grouping: "time", projectOrder: [], projects: [], sections: [], now: NOW }));
    expect(hook.result.current.groups[0].live).toBe(3);
  });

  it("can keyboard-drag a non-sortable thread toward a section", () => {
    const node = document.createElement("div");
    const rect = { top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100 };
    const target = { id: "section:s", disabled: false, node: { current: node },
      data: { current: { sectionId: "s" } }, rect: { current: rect } };
    // useDraggable does not register the active thread as a droppable container.
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    mount([makeThread({ id: "t" })]);
    expect(probes.keyboardCoordinates).not.toBeNull();
    const coordinates = probes.keyboardCoordinates!(new KeyboardEvent("keydown", { code: "ArrowDown" }), {
      currentCoordinates: { x: 0, y: 0 },
      context: {
        active: { id: "thread:t", data: { current: { threadId: "t" } } },
        collisionRect: { ...rect, top: 0, bottom: 40, height: 40 },
        droppableRects: new Map([[target.id, rect]]),
        droppableContainers: { getEnabled: () => [target], get: (id: string) => id === target.id ? target : undefined },
        over: null, scrollableAncestors: [],
      },
    } as unknown as Parameters<KeyboardCoordinateGetter>[1]);
    expect(coordinates).toEqual({ x: 0, y: 25 });
  });

  it("files a thread through the real keyboard sensor and section collision detection", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const destination = this.querySelector(".spooler-group-label")?.textContent === "Destination";
      return new DOMRect(0, destination ? 100 : 300, 200, this.classList.contains("spooler-row-draggable") ? 40 : 100);
    });
    const slot = renderSlot(list, props, {
      sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "keyboard" })],
        projects: [makeProject({ id: "proj_a" })], sections: [makeSection({ id: "dest", name: "Destination" })] },
    });
    const grip = screen.getByRole("button", { name: "Drag onto a section header to file this thread" });
    act(() => { grip.focus(); });
    fireEvent.keyDown(grip, { key: " ", code: "Space" });
    await waitFor(() => expect(slot.container.querySelector(".spooler-thread-drag-preview")).not.toBeNull());
    // KeyboardSensor installs its document listener after the start event.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(grip, { key: "ArrowUp", code: "ArrowUp" });
    }
    await waitFor(() => expect(slot.container.querySelector(".spooler-group-drop-active .spooler-group-label")?.textContent).toBe("Destination"));
    fireEvent.keyDown(grip, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(slot.inspection.sdkCalls).toContainEqual({
      method: "threads.update", args: [{ threadId: "keyboard", sectionId: "dest" }],
    }));
  });

});

describe("thread row layout", () => {
  it("keeps the status cluster on the title line, outside the metadata grid", () => {
    const slot = mount([makeThread({ id: "busy", title: "Busy thread", indicator: "runtime" })]);
    const row = slot.container.querySelector(".spooler-row") as HTMLElement;
    const head = row.querySelector(".spooler-row-head") as HTMLElement;
    expect(head.querySelector(".spooler-row-title")).not.toBeNull();
    expect(head.querySelector(".spooler-row-badges")?.textContent).toContain("Working");
    // The grid is its own line beneath the head, never beside the cluster.
    expect(row.querySelector(".spooler-row-extra")?.closest(".spooler-row-head")).toBeNull();
    expect(row.querySelector(".spooler-row-badges")?.closest(".spooler-row-head")).toBe(head);
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

describe("spool drags across section buckets", () => {
  it("moves every member when a spool card lands on a section bucket", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", sectionId: "old" }), makeThread({ id: "t2", sectionId: "old" })],
        projects: [makeProject({ id: "proj_a" })],
        sections: [makeSection({ id: "old", name: "Old" }), makeSection({ id: "dest", name: "Destination" })] },
    });
    await act(async () => {});
    expect(slot.container.querySelector(".spooler-spool-slot")).not.toBeNull();
    expect(probes.onDragEnd).not.toBeNull();
    act(() => { probes.onDragStart!({ active: { data: { current: { spoolId: "spool_a" } } } }); });
    await act(async () => { probes.onDragEnd!({
      active: { data: { current: { spoolId: "spool_a" } } },
      over: { data: { current: { sectionId: "dest" } } },
    }); });
    const moved = slot.inspection.sdkCalls
      .filter((call) => call.method === "threads.update")
      .map((call) => (call.args[0] as { threadId: string }).threadId);
    expect(moved.sort()).toEqual(["t1", "t2"]);
  });

  it("does nothing when a spool card lands on another spool card", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
        { threadId: "t3", metadata: { spool: "spool_b", spoolJoined: 1, spoolLead: true } },
      ]),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", sectionId: "old" }), makeThread({ id: "t2", sectionId: "old" }), makeThread({ id: "t3", sectionId: "old" })],
        projects: [makeProject({ id: "proj_a" })],
        sections: [makeSection({ id: "old", name: "Old" }), makeSection({ id: "dest", name: "Destination" })] },
    });
    await act(async () => {});
    act(() => { probes.onDragStart!({ active: { data: { current: { spoolId: "spool_a" } } } }); });
    await act(async () => { probes.onDragEnd!({
      active: { data: { current: { spoolId: "spool_a" } } },
      over: { data: { current: { kind: "spool", spoolId: "spool_b" } } },
    }); });
    // Without the guard the undefined sectionId would unfile spool_a's members.
    expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.update")).toEqual([]);
  });

  it("highlights section buckets while a spool is dragged over them", async () => {
    localStorage.setItem("spooler-sidebar:grouping:v1", "section");
    const slot = renderSlot(list, props, {
      sdk: spoolSdk([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", sectionId: "old" }), makeThread({ id: "t2", sectionId: "old" })],
        projects: [makeProject({ id: "proj_a" })],
        sections: [makeSection({ id: "old", name: "Old" }), makeSection({ id: "dest", name: "Destination" })] },
    });
    await act(async () => {});
    act(() => { probes.onDragStart!({ active: { data: { current: { spoolId: "spool_a" } } } }); });
    // The spool sits in "Old" (the lead's section): that bucket reads as
    // "already here", every other bucket reads as a new destination.
    probes.isOver = true;
    slot.rerender(createElement(list.component, { ...props }));
    const cueFor = (name: string): string =>
      slot.container.querySelector(`section[aria-label="${name}"]`)
        ?.closest(".spooler-group-section")?.className ?? "";
    expect(cueFor("Destination")).toContain("spooler-group-drop-active");
    expect(cueFor("Old")).toContain("spooler-group-drop-same");
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

