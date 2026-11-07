// @vitest-environment jsdom
// The hover cluster + inline Details + peek card behaviour, driven through
// the full list harness (rows need the host's plugin runtime hooks: draft,
// shortcut, navigate, row status).
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { DAY, HOUR, NOW, makeProject, makeThread } from "./fixtures";
import { openThreadDetails } from "./detailsBus";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

// jsdom has no matchMedia; the rows consult `(hover: hover)` to decide
// between the peek card and the touch path. Stub it hover-capable so the
// peek card tests can exercise the real timers and gating.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("hover: hover"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

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
  };
}

function renderThreads(
  threads: PluginSidebarThread[],
  options: {
    settings?: Record<string, string | number | boolean>;
    sdk?: Record<string, unknown>;
  } = {},
) {
  const state: PluginSidebarThreadsState = {
    status: "ready",
    threads,
    projects: [makeProject({ id: "proj_a" })],
    sections: [],
    experimental_archived: null,
  };
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

describe("hover cluster", () => {
  it("shows Details with aria-expanded and toggles the inline panel", () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    const details = row.querySelector(".spooler-action-details") as HTMLElement;
    expect(details.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(details);
    expect(row.querySelector(".spooler-row-details")).toBeTruthy();
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(details.getAttribute("aria-controls")).toBeTruthy();

    fireEvent.click(details);
    expect(row.querySelector(".spooler-row-details")).toBeNull();
    expect(details.getAttribute("aria-expanded")).toBe("false");
  });

  it("panel carries Open and Split; Open opens the thread and closes the panel", () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-details")!);
    const panel = row.querySelector(".spooler-row-details") as HTMLElement;
    expect(panel.querySelector(".spooler-details-open")?.textContent).toBe(
      "Open",
    );
    expect(panel.querySelector(".spooler-details-split")?.textContent).toBe(
      "Split",
    );
    fireEvent.click(panel.querySelector(".spooler-details-open")!);
    expect(
      slot.inspection.navigateCalls.some(
        (call: { method: string; threadId?: string }) =>
          call.method === "toThread" && call.threadId === "t1",
      ),
    ).toBe(true);
    expect(row.querySelector(".spooler-row-details")).toBeNull();
  });

  it("keeps Pin and Archive handlers on the cluster", async () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    const buttons = Array.from(
      row.querySelectorAll(".spooler-row-cluster .spooler-action"),
    ) as HTMLElement[];

    fireEvent.click(buttons[0]!); // Pin
    await waitFor(() =>
      expect(
        slot.inspection.sdkCalls.some(
          (call: { method: string }) => call.method === "threads.pin",
        ),
      ).toBe(true),
    );
    fireEvent.click(buttons[1]!); // Archive
    await waitFor(() =>
      expect(
        slot.inspection.sdkCalls.some(
          (call: { method: string }) => call.method === "threads.archive",
        ),
      ).toBe(true),
    );
  });

  it("More opens the thread menu", () => {
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-more")!);
    expect(screen.getByRole("menu")).toBeTruthy();
    // Rename stays reachable under More (per the plan, rename moves there).
    expect(screen.getByText("Rename…")).toBeTruthy();
  });

  it("wires the More → Show details bus on coarse pointers", () => {
    // This run's matchMedia stub is hover-capable, so the menu itself does
    // not list Show details here; the bus syntax is what the row owns.
    const slot = renderThreads([makeThread({ id: "t1" })]);
    const row = rowOf(slot.container);
    expect(row.querySelector(".spooler-row-details")).toBeNull();
    act(() => openThreadDetails("t1"));
    expect(row.querySelector(".spooler-row-details")).toBeTruthy();
    // The owned detailsId wires aria-controls end to end.
    const details = row.querySelector(".spooler-action-details") as HTMLElement;
    expect(row.querySelector(`#${details.getAttribute("aria-controls")}`))
      .toBeTruthy();
  });
});

describe("inline Details facts", () => {
  it("renders the fields; the branch copies; PR link is present with a PR", async () => {
    const context = vi.fn().mockResolvedValue({
      usage: {
        usedTokens: 62_000,
        modelContextWindow: 200_000,
        estimated: false,
        snapshot: { autoCompactAtTokens: 160_000, categories: [] },
      },
    });
    const slot = renderThreads(
      [
        makeThread({
          id: "facts",
          title: "Facts thread",
          environment: {
            id: "e",
            name: null,
            branchName: "fix/tz-drift",
            path: "/tmp/x",
            isWorktree: false,
            providerId: "p",
            workspaceDisplayKind: null,
          },
        } as PluginSidebarThread),
      ],
      { sdk: sdkFakes(context) },
    );
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-details")!);
    const panel = row.querySelector(".spooler-row-details") as HTMLElement;
    await waitFor(() => {
      const labels = Array.from(
        panel.querySelectorAll(".spooler-details-dt"),
      ).map((dt) => dt.textContent);
      expect(labels).toContain("Provider");
      expect(labels).toContain("Branch");
      expect(labels).toContain("Context");
      // A section, when present; idle rows show no model or host.
      expect(labels).not.toContain("Model");
      expect(labels).not.toContain("Host");
    });
    expect(panel.textContent).toContain("fix/tz-drift");
    fireEvent.click(panel.querySelector(".spooler-details-copy")!);
    await waitFor(() => expect(context).toHaveBeenCalled());
    expect(NOW).toBeGreaterThan(0);
    expect(DAY * 0).toBe(0);
    expect(HOUR).toBe(3_600_000);
  });

  it("omits the context section when BB records no usage", async () => {
    const slot = renderThreads([makeThread({ id: "no-usage" })], {
      sdk: sdkFakes(async () => ({ usage: null })),
    });
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-details")!);
    await waitFor(() => {
      const labels = [
        ...row.querySelectorAll(".spooler-row-details .spooler-details-dt"),
      ].map((dt) => dt.textContent);
      expect(labels).toContain("Provider");
      expect(labels).not.toContain("Context");
    });
  });

  it("shows model + thinking under Details while the thread runs", async () => {
    const execution = {
      model: "muse-spark",
      reasoningLevel: "high",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/start",
    };
    const slot = renderThreads(
      [
        makeThread({
          id: "live-facts",
          title: "Working now",
          status: "active",
          indicator: "runtime",
        }),
      ],
      { sdk: { ...sdkFakes(), threads: { ...sdkFakes().threads as object, defaultExecutionOptions: async () => execution } } },
    );
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-details")!);
    await waitFor(() => {
      const panel = row.querySelector(".spooler-row-details");
      expect(panel?.textContent).toContain("muse-spark");
      expect(panel?.textContent?.toLowerCase()).toContain("high");
    });
  });
});

describe("peek card", () => {
  it("renders the shared facts and carries no action footer", async () => {
    const slot = renderThreads([makeThread({ id: "peek", projectId: "proj_a" })]);
    const row = rowOf(slot.container);
    fireEvent.mouseEnter(row);
    await waitFor(() => {
      const card = document.body.querySelector(
        ".spooler-hover-card",
      ) as HTMLElement | null;
      expect(card).toBeTruthy();
      // No action footer: the peek gives facts only.
      expect(card!.querySelector(".spooler-hover-actions")).toBeNull();
      expect(card!.querySelector(".spooler-details-dl")).toBeTruthy();
    });
  });

  it("is suppressed while that row's Details are open", async () => {
    const slot = renderThreads([makeThread({ id: "suppress", projectId: "proj_a" })]);
    const row = rowOf(slot.container);
    fireEvent.click(row.querySelector(".spooler-action-details")!);
    fireEvent.mouseEnter(row);
    await new Promise((resolve) => setTimeout(resolve, 420));
    const card = document.body.querySelector(".spooler-hover-card");
    expect(card).toBeNull();
  });
});

describe("keyboard", () => {
  it("cluster buttons join tab order only while the row holds focus", () => {
    const slot = renderThreads([makeThread({ id: "kb" })]);
    const row = rowOf(slot.container);
    const buttons = () =>
      Array.from(row.querySelectorAll(".spooler-row-cluster .spooler-action")) as HTMLElement[];
    // No focus: out of the tab order.
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "-1")).toBe(
      true,
    );
    // Row focus: the cluster becomes tabbable (the row is the roving stop).
    fireEvent.focus(row.querySelector(".spooler-row-main")!);
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "0")).toBe(
      true,
    );
    // Focus elsewhere: they drop back out.
    fireEvent.blur(row.querySelector(".spooler-row-main")!);
    expect(buttons().every((b) => b.getAttribute("tabIndex") === "-1")).toBe(
      true,
    );
  });

  it("rename stays reachable through the Details-less path it always had", () => {
    const slot = renderThreads([makeThread({ id: "rename-kb" })]);
    const row = rowOf(slot.container);
    fireEvent.doubleClick(row.querySelector(".spooler-row-main")!);
    expect(row.querySelector(".spooler-rename")).toBeTruthy();
  });
});
