// @vitest-environment jsdom
// The v2 inline Details behaviour, driven through the full list harness:
// per-row chevron (selection never opens the panel), flush panel under the
// header tube, facts without Status/Provider/Section rows, filled context
// bar. The peek card retired — hover paints nothing.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { makeProject, makeSection, makeThread } from "./fixtures";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

function sdkFakes(
  context: (threadId: string) => Promise<unknown> = async () => ({
    usage: {
      usedTokens: 62_000,
      modelContextWindow: 200_000,
      estimated: false,
      snapshot: { autoCompactAtTokens: 160_000, categories: [] },
    },
  }),
  execution: unknown = null,
): Record<string, unknown> {
  return {
    threads: {
      experimental_listPluginMetadata: async () => ({ threads: [] }),
      update: async () => ({ ok: true }),
      archive: async () => ({ ok: true }),
      unarchive: async () => ({ ok: true }),
      pin: async () => ({ ok: true }),
      unpin: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      markUnread: async () => ({ ok: true }),
      context,
      defaultExecutionOptions: async () => execution,
    },
    providers: { models: async () => ({ models: [] }) },
    system: {
      uiPreferences: {
        list: async () => ({ preferences: {} }),
        set: async () => ({ revision: 1, value: [] }),
      },
    },
  };
}

function renderThreads(
  threads: PluginSidebarThread[],
  options: {
    settings?: Record<string, string | number | boolean>;
    sdk?: Record<string, unknown>;
    sections?: PluginSidebarThreadsState["sections"];
    activeThreadId?: string | null;
  } = {},
) {
  const state: PluginSidebarThreadsState = {
    status: "ready",
    threads,
    projects: [makeProject({ id: "proj_a" })],
    sections: options.sections ?? [],
    experimental_archived: null,
  };
  return renderSlot(
    threadList,
    {
      activeThreadId: options.activeThreadId ?? null,
      activeProjectId: "proj_a",
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sdk: options.sdk ?? sdkFakes(),
      ...options,
      providers: { status: "ready", providers: [{ id: "pi", displayName: "Pi", logoUrl: null, icon: { glyph: "π" } }] },
      sidebarThreads: state,
    },
  );
}

const rowOf = (container: HTMLElement) =>
  container.querySelector(".spooler-row") as HTMLElement;
const openDetails = (row: HTMLElement) => {
  fireEvent.click(row.querySelector(".spooler-row-toggle")!);
  return row.querySelector(".spooler-row-details");
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("per-row chevron", () => {
  it("opens with the chevron; selecting never opens details", () => {
    const slot = renderThreads(
      [makeThread({ id: "t1" }), makeThread({ id: "t2" })],
      { activeThreadId: "t1" },
    );
    const rows = slot.container.querySelectorAll(".spooler-row");
    // Selection alone = tone only. No panel without the chevron.
    expect(rows[0]!.querySelector(".spooler-row-details")).toBeNull();
    expect(rows[1]!.querySelector(".spooler-row-details")).toBeNull();
    // The toggle exists on every row with aria-expanded wiring.
    const toggle = rows[0]!.querySelector(".spooler-row-toggle") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeTruthy();
    fireEvent.click(toggle);
    const panel = rows[0]!.querySelector(".spooler-row-details") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // The box marks itself open for the corner-squaring CSS.
    expect(rows[0]!.className).toContain("spooler-row-open");
    // The other row stays closed; a second panel may exist side by side.
    fireEvent.click(rows[1]!.querySelector(".spooler-row-toggle")!);
    expect(rows[1]!.querySelector(".spooler-row-details")).toBeTruthy();
    // Toggling again closes it.
    fireEvent.click(rows[0]!.querySelector(".spooler-row-toggle")!);
    expect(rows[0]!.querySelector(".spooler-row-details")).toBeNull();
  });

  it("panel carries Open and Split; Open navigates", () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    const panel = openDetails(row) as HTMLElement;
    expect(panel.querySelector(".spooler-details-open")?.textContent).toBe("Open");
    expect(panel.querySelector(".spooler-details-split")?.textContent).toBe("Split");
    fireEvent.click(panel.querySelector(".spooler-details-open")!);
    expect(slot.inspection.navigateCalls.some((call: { method: string; threadId?: string }) =>
      call.method === "toThread" && call.threadId === "t1")).toBe(true);
  });

  it("the hairline separator rides the panel top; no header inside the panel", () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const panel = openDetails(rowOf(slot.container)) as HTMLElement;
    expect(panel.querySelector(".spooler-row-details-sep")).toBeTruthy();
    // No duplicated header: no provider icon block, no title inside the panel.
    expect(panel.querySelector(".spooler-details-head")).toBeNull();
    expect(panel.querySelector(".spooler-details-provider-icon")).toBeNull();
    expect(panel.querySelector(".spooler-details-title")).toBeNull();
  });
});

describe("sub-head (the row's header default content)", () => {
  it("carries provider name · time left and the project right-justified", () => {
    const slot = renderThreads(
      [makeThread({ id: "sub-h", title: "Header thread", projectId: "proj_a" })],
      { activeThreadId: "sub-h" },
    );
    const row = rowOf(slot.container);
    const sub = row.querySelector(".spooler-row-sub") as HTMLElement;
    const left = sub.querySelector(".spooler-row-sub-left") as HTMLElement;
    expect(left.querySelector(".spooler-row-sub-prov")).not.toBeNull();
    expect(left.querySelector(".spooler-row-time")).not.toBeNull();
    const right = sub.querySelector(".spooler-row-sub-right") as HTMLElement;
    expect(right.querySelector(".spooler-row-project")?.textContent).toContain("proj_a");
    // No duplicated meta line; provider icon lives in the gutter rail.
    expect(row.querySelector(".spooler-row-provider")).not.toBeNull();
    expect(row.querySelector(".spooler-row-meta")).toBeNull();
  });
});

describe("facts", () => {
  it("fields: Goal, Model · effort; NO Status/Provider/Section rows; branch copies", async () => {
    const slot = renderThreads([
      makeThread({
        id: "facts",
        title: "Facts thread",
        environment: {
          id: "e", name: null, branchName: "fix/tz-drift", path: "/tmp/x",
          isWorktree: false, providerId: "p", workspaceDisplayKind: null,
        },
      } as PluginSidebarThread),
    ]);
    const panel = openDetails(rowOf(slot.container)) as HTMLElement;
    await waitFor(() => {
      const labels = Array.from(panel.querySelectorAll(".spooler-details-dt")).map((dt) => dt.textContent);
      // Activity rides every panel: the sub-head's short time is tooltip-
      // only on the desktop, and touch has no tooltips to read.
      expect(labels).toEqual(["Activity", "Branch", "Context"]);
      // No Status / Provider / Section rows anywhere.
      expect(labels).not.toContain("Status");
      expect(labels).not.toContain("Provider");
      expect(labels).not.toContain("Section");
    });
    expect(panel.textContent).toContain("fix/tz-drift");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(panel.querySelector(".spooler-details-copy")!);
    expect(writeText).toHaveBeenCalledWith("fix/tz-drift");
  });

  it("shows model + effort even when the thread is idle", async () => {
    const execution = {
      model: "muse-spark", reasoningLevel: "high", permissionMode: "full",
      serviceTier: "default", source: "client/turn/start",
    };
    const slot = renderThreads([
      makeThread({ id: "idle-facts", title: "Idle now", indicator: "none" }),
    ], {
      sdk: sdkFakes(undefined, execution),
    });
    const panel = openDetails(rowOf(slot.container)) as HTMLElement;
    await waitFor(() => {
      expect(panel.textContent).toContain("muse-spark");
      expect(panel.textContent.toLowerCase()).toContain("effort high");
    });
  });

  it("omits the context section when BB records no usage; the bar fills when it records some", async () => {
    const withContext = renderThreads([makeThread({ id: "usage" })]);
    const panel = openDetails(rowOf(withContext.container)) as HTMLElement;
    await waitFor(() => {
      expect(Array.from(panel.querySelectorAll<HTMLElement>(".spooler-details-dt")).map((dt) => dt.textContent))
        .toContain("Context");
      // Base fill painted: the used segment exists with a real width.
      const seg = panel.querySelector(".spooler-details-bar-seg");
      expect(seg?.getAttribute("style")).toContain("31%");
    });
    cleanup();
    const without = renderThreads([makeThread({ id: "no-usage" })], {
      sdk: sdkFakes(async () => ({ usage: null })),
    });
    const panel2 = openDetails(rowOf(without.container)) as HTMLElement;
    await waitFor(() => {
      expect(Array.from(panel2.querySelectorAll<HTMLElement>(".spooler-details-dt")).map((dt) => dt.textContent))
        .not.toContain("Context");
    });
  });
});

describe("peek card (retired)", () => {
  it("renders nothing on hover", async () => {
    const slot = renderThreads([makeThread({ id: "peek" })]);
    fireEvent.mouseEnter(rowOf(slot.container));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(document.body.querySelector(".spooler-hover-card")).toBeNull();
  });
});

describe("keyboard", () => {
  it("⋯ + chevron join tab order only while the row holds focus", () => {
    const slot = renderThreads([makeThread({ id: "kb" })]);
    const row = rowOf(slot.container);
    const buttons = () => Array.from(row.querySelectorAll(".spooler-row-more, .spooler-row-toggle")) as HTMLElement[];
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "-1")).toBe(true);
    fireEvent.focus(row.querySelector(".spooler-row-main")!);
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "0")).toBe(true);
    fireEvent.blur(row.querySelector(".spooler-row-main")!);
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "-1")).toBe(true);
  });

  it("⋯ opens the row's context menu with Archive/Delete under Rename", () => {
    const slot = renderThreads([makeThread({ id: "menu-row" })]);
    fireEvent.click(rowOf(slot.container).querySelector(".spooler-row-more")!);
    expect(screen.getByRole("menu")).toBeTruthy();
    const texts = Array.from(screen.getByRole("menu").querySelectorAll("button")).map((b) => b.textContent);
    expect(texts.indexOf("Rename…")).toBeLessThan(texts.indexOf("Archive"));
    expect(texts.indexOf("Archive")).toBeLessThan(texts.indexOf("Delete…"));
    expect(texts[texts.length - 1]).toBe("Copy link");
  });

  it("rename stays reachable through double-click", () => {
    const slot = renderThreads([makeThread({ id: "rename-kb" })]);
    const row = rowOf(slot.container);
    fireEvent.doubleClick(row.querySelector(".spooler-row-main")!);
    expect(row.querySelector(".spooler-rename")).toBeTruthy();
  });
});
