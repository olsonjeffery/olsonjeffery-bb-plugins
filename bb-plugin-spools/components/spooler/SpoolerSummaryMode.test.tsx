// @vitest-environment jsdom
// The `threadSummary` setting through the real list: how much the thread box
// (title + summary line, without the open details panel) shows, and where
// the Thread Tags badges ride. The details panel is a separate surface and
// keeps every fact in both modes.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type FunctionComponent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeProject, makeSection, makeThread } from "./fixtures";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

const tagState = {
  tags: [
    { id: "urgent", label: "🔥", color: "#ef4444" },
    { id: "review", label: "👀", color: "#f59e0b" },
  ],
  assignments: {
    focus: "urgent",
    needs: "urgent",
    away: "review",
  },
};

function sdkFakes(): Record<string, unknown> {
  return {
    threads: {
      experimental_listPluginMetadata: async () => ({ threads: [] }),
      updatePluginMetadata: async () => ({ ok: true }),
      defaultExecutionOptions: async () => null,
      update: async () => ({ ok: true }),
      archive: async () => ({ ok: true }),
      unarchive: async () => ({ ok: true }),
      pin: async () => ({ ok: true }),
      unpin: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      markUnread: async () => ({ ok: true }),
      context: async () => ({ usage: null }),
    },
    providers: { models: async () => ({ models: [] }) },
    system: {
      uiPreferences: {
        list: async () => ({ preferences: {} }),
        set: async () => ({ revision: 1, value: [] }),
      },
    },
    plugins: {
      list: async () => ({
        plugins: [{
          id: "thread-tags",
          enabled: true,
          status: "running",
          version: "0.1.0",
        }],
      }),
      callRpc: async (args: { method: string }) => {
        expect(args.method).toBe("state_get");
        return tagState;
      },
    },
  };
}

interface RenderOptions {
  settings: Record<string, string | number | boolean>;
  threads: PluginSidebarThread[];
  sections?: ReturnType<typeof makeSection>[];
}

function renderThreads(options: RenderOptions): RenderedSlot {
  return renderSlot(
    threadList,
    {
      activeThreadId: null,
      activeProjectId: "proj_a",
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sdk: sdkFakes(),
      settings: options.settings,
      sidebarThreads: {
        status: "ready",
        threads: options.threads,
        projects: [makeProject({ id: "proj_a" })],
        sections: options.sections ?? [makeSection({ id: "sec-a", name: "Lab" })],
        experimental_archived: null,
      },
    },
  );
}

function rowOf(slot: RenderedSlot, threadId: string): HTMLElement {
    const link = slot.container?.querySelector(
    `[data-sidebar-thread-id="${threadId}"]`,
  );
  expect(link).not.toBeNull();
  return link!.closest(".spooler-row") as HTMLElement;
}

const badgeOf = (row: HTMLElement) =>
  row.querySelector(".spooler-row-sub-right .spooler-tag-badge") as HTMLElement | null;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("threadSummary — show more information", () => {
  it("keeps the whole summary and pays the tag badge extra", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "more" },
      threads: [
        makeThread({ id: "focus", title: "Drift fix", projectId: "proj_a" }),
      ],
    });
        await waitFor(() => expect(badgeOf(rowOf(slot, "focus"))).not.toBeNull());
    const row = rowOf(slot, "focus");
    const subRight = row.querySelector(".spooler-row-sub-right") as HTMLElement;
    // Provider and short time stay on the left…
    expect(
      (row.querySelector(".spooler-row-sub-left") as HTMLElement)
        .querySelector(".spooler-row-sub-prov"),
    ).not.toBeNull();
    expect(
      (row.querySelector(".spooler-row-sub-left") as HTMLElement)
        .querySelector(".spooler-row-time"),
    ).not.toBeNull();
    // …and the project, right-justified behind the tag badge.
    expect(subRight.querySelector(".spooler-row-project")).not.toBeNull();
    expect(badgeOf(rowOf(slot, "focus"))!.textContent).toBe("🔥");
  });

  it("names an away-from-home host in the summary", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "more" },
      threads: [
        // The home host is whichever runs the most threads; a lone away
        // thread only reads away against other host traffic.
        makeThread({ id: "home-row", title: "Home thread" }),
        makeThread({ id: "home-row-2", title: "Home thread two" }),
        makeThread({
          id: "away",
          title: "Remote work",
          host: { id: "host_2", name: "Edge Box" },
        }),
      ],
    });
    await waitFor(() => expect(badgeOf(rowOf(slot, "away"))).not.toBeNull());
    const row = rowOf(slot, "away");
    const host = row.querySelector(".spooler-row-host") as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host!.textContent).toBe("Edge Box");
  });

  it("shows no badges when thread-tags is missing — everything else unchanged", async () => {
    const fakes = sdkFakes();
    (fakes.plugins as Record<string, unknown>).list = async () => ({ plugins: [] });
    const slot = renderSlot(
      threadList,
      {
        activeThreadId: null,
        activeProjectId: "proj_a",
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
      },
      {
        sdk: fakes,
        settings: { threadSummary: "more" },
        sidebarThreads: {
          status: "ready",
          threads: [makeThread({ id: "focus", title: "Drift fix" })],
          projects: [makeProject({ id: "proj_a" })],
          sections: [],
          experimental_archived: null,
        },
      },
    );
    await waitFor(() =>
      expect(
        slot.container.querySelector("[data-sidebar-thread-id='focus']"),
      ).not.toBeNull(),
    );
    expect(slot.container.querySelector(".spooler-tag-badge")).toBeNull();
    expect(
      (slot.container.querySelector(".spooler-row-sub-right") as HTMLElement)
        .querySelector(".spooler-row-project"),
    ).not.toBeNull();
  });
});

describe("threadSummary — show minimal", () => {
  it("drops provider, project and PR from the sub-head; keeps status and time", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "minimal" },
      threads: [
        makeThread({
          id: "quiet",
          title: "Quiet done",
          indicator: "none",
          environment: {
            id: "env_q", name: null, branchName: "b", path: null,
            isWorktree: false, providerId: "p", workspaceDisplayKind: null,
          },
        }),
        makeThread({
          id: "needs",
          title: "Waits on you",
          indicator: "waiting-for-input",
        }),
      ],
    });
    const quiet = rowOf(slot, "quiet");
    expect(
      (quiet.querySelector(".spooler-row-sub-left") as HTMLElement)
        .querySelector(".spooler-row-sub-prov"),
    ).toBeNull();
    expect(
      (quiet.querySelector(".spooler-row-sub-left") as HTMLElement)
        .querySelector(".spooler-row-time"),
    ).not.toBeNull();
    expect(
      (quiet.querySelector(".spooler-row-sub-right") as HTMLElement)
        .querySelector(".spooler-row-project"),
    ).toBeNull();
    // Status stays loud for the row that needs you.
    const needs = rowOf(slot, "needs");
    expect(needs.querySelector(".spooler-status-pill")!.textContent).toBe("Needs you");
    // The tag badge survives the lean summary — it is the user's own signal.
    await waitFor(() => expect(badgeOf(needs)).not.toBeNull());
  });

  it("keeps only the attention family rollup; unread and working live one dot lower", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "minimal" },
      threads: [
        makeThread({
          id: "parent-failed",
          title: "Family under it",
          indicator: "none",
        }),
        makeThread({
          id: "failed-child",
          title: "Broken child",
          parentThreadId: "parent-failed",
          isUnread: true,
          indicator: "unread-error",
        }),
      ],
    });
    // Fold the family, then read the parent's summary.
    fireEvent.click(
      rowOf(slot, "parent-failed").querySelector(".spooler-tree-toggle")!,
    );
    const right = (
      rowOf(slot, "parent-failed").querySelector(
        ".spooler-row-sub-right",
      ) as HTMLElement
    ).textContent ?? "";
    expect(right).toContain("failed");
    expect(right).not.toContain("replies");
  });
});

describe("thread-detail facts", () => {
  it("shows the tag as its own line item beside the kept facts", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "more" },
      threads: [
        makeThread({
          id: "focus",
          title: "Drift fix",
          projectId: "proj_a",
          environment: {
            id: "env_f", name: null, branchName: "fix/drift", path: null,
            isWorktree: false, providerId: "p", workspaceDisplayKind: null,
          },
          host: { id: "host_2", name: "Edge Box" },
        }),
        // Two more threads on the home host: "home" is whichever host runs
        // the most threads, and detail rows stay on the away thread only.
        makeThread({ id: "home-row", title: "Home thread" }),
        makeThread({ id: "home-row2", title: "Home thread two" }),
      ],
    });
    await waitFor(() => expect(badgeOf(rowOf(slot, "focus"))).not.toBeNull());
    const row = rowOf(slot, "focus");
    fireEvent.click(row.querySelector(".spooler-row-toggle")!);
    const panel = row.querySelector(".spooler-row-details") as HTMLElement;
    const labels = Array.from(panel.querySelectorAll(".spooler-details-dt"))
      .map((dt) => dt.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Activity", "Tag", "Host", "Branch"]),
    );
    const tagDd = panel.querySelector(".spooler-details-tag") as HTMLElement;
    expect(tagDd.querySelector(".spooler-tag-badge")!.textContent).toBe("🔥");
  });

  it("omits the Tag line when the thread wears none", async () => {
    const slot = renderThreads({
      settings: { threadSummary: "more" },
      threads: [makeThread({ id: "untagged", title: "Plain" })],
    });
    const row = rowOf(slot, "untagged");
    expect(badgeOf(row)).toBeNull();
    fireEvent.click(row.querySelector(".spooler-row-toggle")!);
    const labels = Array.from(
      (row.querySelector(".spooler-row-details") as HTMLElement)
        .querySelectorAll(".spooler-details-dt"),
    ).map((dt) => dt.textContent);
    expect(labels).not.toContain("Tag");
  });
});
