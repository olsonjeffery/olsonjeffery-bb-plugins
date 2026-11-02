// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeProject, makeThread } from "./fixtures";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;
const COLLAPSE_KEY = "spooler-sidebar:filters-collapsed:v1";

function sdkFakes(): Record<string, unknown> {
  return {
    threads: {
      defaultExecutionOptions: async () => null,
      update: async () => ({ ok: true }),
      archive: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      markUnread: async () => ({ ok: true }),
      context: async () => ({ usage: null }),
    },
    providers: { models: async () => ({ models: [] }) },
  };
}

const props = {
  activeThreadId: null,
  activeProjectId: "proj_a",
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
};

function renderThreads(
  threads: PluginSidebarThread[],
  options: { startup?: string } = {},
): RenderedSlot {
  if (options.startup) localStorage.setItem(COLLAPSE_KEY, options.startup);
  return renderSlot(threadList, props, {
    sdk: sdkFakes(),
    settings: {},
    sidebarThreads: {
      status: "ready",
      threads,
      projects: [makeProject({ id: "proj_a" })],
      sections: [],
      experimental_archived: null,
    },
  });
}

const runnerAndQuiet = () => [
  makeThread({ id: "runner", status: "active", indicator: "runtime" }),
  makeThread({ id: "quiet" }),
];

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  localStorage.setItem("spooler-sidebar:grouping:v1", "time");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("spooler-sidebar:grouping:v1", "time");
  vi.restoreAllMocks();
});

describe("collapsible filter header", () => {
  it("starts expanded: lifecycle switch, status chips and grouping all present", () => {
    renderThreads(runnerAndQuiet());
    expect(
      screen.getByRole("group", { name: "Thread lifecycle" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: "Status filter" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Hide filter controls" }),
    ).toBeTruthy();
  });

  it("expanded: the toggle rides the search row; collapsed: the filter field is hidden", () => {
    const slot = renderThreads(runnerAndQuiet());
    let row = slot.container.querySelector(".spooler-search-row");
    expect(row?.querySelector(".spooler-search")).not.toBeNull();
    expect(row?.querySelector(".spooler-filters-toggle")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide filter controls" }));
    row = slot.container.querySelector(".spooler-search-row");
    expect(row?.querySelector(".spooler-search")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("collapsed: the Grouping widget anchors the left, the chevron right-justifies", () => {
    const slot = renderThreads(runnerAndQuiet());
    fireEvent.click(screen.getByRole("button", { name: "Hide filter controls" }));
    const row = slot.container.querySelector(".spooler-search-row");
    expect(row?.querySelector(".spooler-search")).toBeNull();
    expect(row?.firstElementChild?.classList.contains("spooler-filters-mini"))
      .toBe(true);
    expect(row?.lastElementChild?.classList.contains("spooler-filters-toggle"))
      .toBe(true);
  });

  it("the chevron follows the disclosure convention: right when collapsed, down when expanded", () => {
    const slot = renderThreads(runnerAndQuiet());
    const toggle = () =>
      slot.container.querySelector<HTMLElement>(".spooler-filters-toggle");
    expect(
      toggle()?.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
    fireEvent.click(toggle()!);
    expect(
      toggle()?.querySelector('[data-icon="ChevronRight"]'),
    ).not.toBeNull();
    fireEvent.click(toggle()!);
    expect(
      toggle()?.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
  });

  it("pressing / while collapsed expands the header and focuses the filter", async () => {
    const slot = renderThreads(runnerAndQuiet(), { startup: "on" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.keyDown(document.body, { key: "/" });
    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).not.toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    });
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("off");
  });

  it("collapses to one line: only the Grouping widget shows of the controls", () => {
    const slot = renderThreads(runnerAndQuiet());
    fireEvent.click(screen.getByRole("button", { name: "Hide filter controls" }));

    // The extras are gone…
    expect(screen.queryByRole("group", { name: "Thread lifecycle" })).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: "Status filter" }),
    ).toBeNull();
    // …the Grouping widget moved onto the (one) search row…
    const row = slot.container.querySelector(".spooler-search-row");
    expect(
      row?.querySelector(".spooler-filters-mini .spooler-segmented-button"),
    ).not.toBeNull();
    // …with exactly one instance of each mode button.
    expect(
      screen.getAllByRole("button", { name: "Group by time" }),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Show filter controls" }))
      .toBeTruthy();
  });

  it("the collapse persists across a remount", () => {
    renderThreads(runnerAndQuiet());
    fireEvent.click(screen.getByRole("button", { name: "Hide filter controls" }));
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("on");
    cleanup();
    renderThreads(runnerAndQuiet());
    expect(screen.queryByRole("group", { name: "Thread lifecycle" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show filter controls" }),
    ).toBeTruthy();
  });

  it("expanding restores every control and clears the stored choice", () => {
    renderThreads(runnerAndQuiet(), { startup: "on" });
    fireEvent.click(screen.getByRole("button", { name: "Show filter controls" }));
    expect(screen.getByRole("group", { name: "Thread lifecycle" })).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: "Status filter" }),
    ).toBeTruthy();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("off");
  });

  it("the mini widget still switches grouping while collapsed", async () => {
    const slot = renderThreads(runnerAndQuiet(), { startup: "on" });
    fireEvent.click(screen.getByRole("button", { name: "Group by time" }));
    await act(async () => {});
    expect(
      slot.container.querySelectorAll(".spooler-group").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Group by section (drag threads between them)" }))
      .toBeTruthy();
  });
});
