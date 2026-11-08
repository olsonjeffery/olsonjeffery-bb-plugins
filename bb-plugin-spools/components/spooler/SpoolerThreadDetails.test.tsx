// @vitest-environment jsdom
// The always-open inline Details behaviour, driven through the full list
// harness (rows need the host's plugin runtime hooks: draft, shortcut,
// navigate, row status). The peek card retired: its tests left with it.
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
import { DAY, HOUR, NOW, makeProject, makeSection, makeThread } from "./fixtures";

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
      defaultExecutionOptions: async () => null,
    },
    providers: { models: async () => ({ models: [] }) },
    system: {
      uiPreferences: {
        list: async () => ({ preferences: {} }),
        set: async () => ({ revision: 1, value: [] }),
      },
    },
    environmentContext: async () => ({ pullRequest: null }),
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
      sidebarThreads: state,
    },
  );
}

const rowOf = (container: HTMLElement) =>
  container.querySelector(".spooler-row") as HTMLElement;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("always-open details", () => {
  it("opens with the selected thread: no chevron, no hover cluster", async () => {
    const slot = renderThreads([makeThread({ id: "t1" })], {
      activeThreadId: "t1",
    });
    const row = rowOf(slot.container);
    // No disclosure button exists anywhere on the row.
    expect(row.querySelector(".spooler-action-details")).toBeNull();
    expect(row.querySelector(".spooler-row-cluster")).toBeNull();
    // The panel is simply there, under the selected row.
    const panel = row.querySelector(".spooler-row-details") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("role")).toBe("region");
    expect(panel.querySelector(".spooler-details-open")?.textContent).toBe(
      "Open",
    );
    expect(panel.querySelector(".spooler-details-split")?.textContent).toBe(
      "Split",
    );
  });

  it("stays closed while the thread is not the selected one", () => {
    const slot = renderThreads(
      [makeThread({ id: "a" }), makeThread({ id: "b" })],
      { activeThreadId: "a" },
    );
    expect(rowOf(slot.container).querySelector(".spooler-row-details")).toBeTruthy();
    const other = slot.container.querySelectorAll(".spooler-row")[1]!;
    expect(other!.querySelector(".spooler-row-details")).toBeNull();
  });

  it("Open opens the thread; the branch copies", async () => {
    const branchEnv = {
      id: "e",
      name: null,
      branchName: "fix/tz-drift",
      path: "/tmp/x",
      isWorktree: false,
      providerId: "p",
      workspaceDisplayKind: null,
    };
    const slot = renderThreads(
      [makeThread({ id: "t1", title: "Facts thread", environment: branchEnv } as PluginSidebarThread)],
      { activeThreadId: "t1" },
    );
    const row = rowOf(slot.container);
    const panel = row.querySelector(".spooler-row-details") as HTMLElement;
    fireEvent.click(panel.querySelector(".spooler-details-open")!);
    expect(
      slot.inspection.navigateCalls.some(
        (call: { method: string; threadId?: string }) =>
          call.method === "toThread" && call.threadId === "t1",
      ),
    ).toBe(true);
    // The branch is in the list and copies.
    expect(panel.textContent).toContain("fix/tz-drift");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(panel.querySelector(".spooler-details-copy")!);
    expect(writeText).toHaveBeenCalledWith("fix/tz-drift");
  });

  it("carries the compact header: provider icon slot, provider name, time", async () => {
    const slot = renderThreads(
      [
        makeThread({
          id: "head",
          title: "Header thread",
          status: "active",
          indicator: "runtime",
        }),
      ],
      {
        activeThreadId: "head",
        sdk: {
          ...sdkFakes(),
          threads: {
            ...(sdkFakes().threads as Record<string, unknown>),
          },
        },
        settings: { providers: "pi", providersTable: undefined },
      } as never,
    ).container;
    const panel = rowOf(slot).querySelector(".spooler-row-details") as HTMLElement;
    expect(panel.querySelector(".spooler-details-head")).toBeTruthy();
    expect(panel.querySelector(".spooler-details-meta, .spooler-details-head-meta")).toBeTruthy();
    // The header carries provider + time; the details list has no Provider
    // row and no Section row.
    const labels = Array.from(
      panel.querySelectorAll(".spooler-details-dt"),
    ).map((dt) => dt.textContent);
    expect(labels).not.toContain("Provider");
    expect(labels).not.toContain("Section");
  });

  it("shows model + effort even when the thread is idle", async () => {
    const execution = {
      model: "muse-spark",
      reasoningLevel: "high",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/start",
    };
    const slot = renderThreads(
      [makeThread({ id: "idle-facts", title: "Idle now", status: "idle", indicator: "none" })],
      {
        activeThreadId: "idle-facts",
        sdk: {
          ...sdkFakes(),
          threads: {
            ...(sdkFakes().threads as Record<string, unknown>),
            defaultExecutionOptions: async () => execution,
          },
        },
      },
    );
    const panel = rowOf(slot.container).querySelector(".spooler-row-details") as HTMLElement;
    await waitFor(() => {
      expect(panel.textContent).toContain("muse-spark");
    });
    expect(panel.textContent.toLowerCase()).toContain("effort high");
    // No catalog entry in the stub, so the raw id is the documented fallback.
  });

  it("renders the context section; omits it when BB records no usage", async () => {
    const withUsage = renderThreads([makeThread({ id: "usage" })], {
      activeThreadId: "usage",
    });
    await waitFor(() => {
      const labels = Array.from(
        withUsage.container.querySelectorAll(".spooler-row-details .spooler-details-dt"),
      ).map((dt) => dt.textContent);
      expect(labels).toContain("Context");
    });
    cleanup();
    const without = renderThreads([makeThread({ id: "no-usage" })], {
      activeThreadId: "no-usage",
      sdk: sdkFakes(async () => ({ usage: null })),
    });
    await waitFor(() => {
      const labels = Array.from(
        without.container.querySelectorAll(".spooler-row-details .spooler-details-dt"),
      ).map((dt) => dt.textContent);
      expect(labels).not.toContain("Context");
    });
  });

  it("renders goal/status/replies labels, never a section row", async () => {
    const slot = renderThreads(
      [
        makeThread({
          id: "parent",
          title: "Family parent",
          status: "active",
          indicator: "runtime",
        }),
        makeThread({
          id: "kid",
          parentThreadId: "parent",
          title: "Kid reply",
          indicator: "none",
        }),
      ],
      { activeThreadId: "parent", sections: [makeSection({ id: "s1", name: "Board" })] },
    );
    const panel = rowOf(slot.container).querySelector(".spooler-row-details") as HTMLElement;
    await waitFor(() => {
      const labels = Array.from(panel.querySelectorAll(".spooler-details-dt")).map(
        (dt) => dt.textContent,
      );
      expect(labels).toContain("Replies");
      expect(labels).toContain("Status");
    });
    expect(NOW).toBeGreaterThan(0);
    expect(slot.container.querySelector(".spooler-row-details")).toBeTruthy();
    // Sanity on the retained fixture helpers.
    expect(DAY).toBe(86_400_000);
    expect(HOUR).toBe(3_600_000);
    // The section name lives in the sidebar's own caption, never in the
    // panel — no Section fact row may return.
    expect(panel.textContent).not.toContain("Board");
  });
});

describe("peek card (retired)", () => {
  it("renders nothing on hover", async () => {
    const slot = renderThreads([makeThread({ id: "peek" })], {
      activeThreadId: "peek",
    });
    const row = rowOf(slot.container);
    fireEvent.mouseEnter(row);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(document.body.querySelector(".spooler-hover-card")).toBeNull();
    // The DETAILS panel is always present for the selected row instead.
    expect(row.querySelector(".spooler-row-details")).toBeTruthy();
  });
});

describe("keyboard", () => {
  it("the ⋯ joins tab order only while the row holds focus", () => {
    const slot = renderThreads([makeThread({ id: "kb" })]);
    const row = rowOf(slot.container);
    const more = () => row.querySelector(".spooler-row-more") as HTMLElement;
    expect(more().getAttribute("tabIndex")).toBe("-1");
    fireEvent.focus(row.querySelector(".spooler-row-main")!);
    expect(more().getAttribute("tabIndex")).toBe("0");
    fireEvent.blur(row.querySelector(".spooler-row-main")!);
    expect(more().getAttribute("tabIndex")).toBe("-1");
  });

  it("⋯ opens the row's context menu", () => {
    const slot = renderThreads([makeThread({ id: "menu-row" })]);
    fireEvent.click(rowOf(slot.container).querySelector(".spooler-row-more")!);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Rename…")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
    expect(screen.getByText("Delete…")).toBeTruthy();
  });

  it("rename stays reachable through double-click", () => {
    const slot = renderThreads([makeThread({ id: "rename-kb" })]);
    const row = rowOf(slot.container);
    fireEvent.doubleClick(row.querySelector(".spooler-row-main")!);
    expect(row.querySelector(".spooler-rename")).toBeTruthy();
  });
});
