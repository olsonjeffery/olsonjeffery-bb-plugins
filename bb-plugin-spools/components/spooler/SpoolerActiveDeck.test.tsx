// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

function sdkFakes(): Record<string, unknown> {
  return {
    threads: {
      defaultExecutionOptions: async () => null,
      update: async () => ({ ok: true }),
      archive: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      markUnread: async () => ({ ok: true }),
      context: async () => ({ usage: null }),
      experimental_listPluginMetadata: async () => ({ threads: [] }),
      updatePluginMetadata: async () => ({}),
    },
    providers: { models: async () => ({ models: [] }) },
  };
}

type MetaRowFixture = {
  threadId: string;
  metadata: { [key: string]: string | number | boolean };
};

function sdkWithSpoolMetadata(metadata: MetaRowFixture[]): Record<string, unknown> {
  return {
    ...sdkFakes(),
    threads: {
      ...(sdkFakes().threads as object),
      experimental_listPluginMetadata: async () => ({ threads: metadata }),
      updatePluginMetadata: async () => ({}),
    },
  };
}

function renderThreads(
  threads: PluginSidebarThread[],
  options: {
    settings?: Record<string, string | number | boolean>;
    sections?: ReturnType<typeof makeSection>[];
    sdk?: Record<string, unknown>;
  } = {},
): RenderedSlot {
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
      settings: options.settings ?? {},
      sidebarThreads: {
        status: "ready",
        threads,
        projects: [makeProject({ id: "proj_a" })],
        sections: options.sections ?? [],
        experimental_archived: null,
      },
    },
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  localStorage.setItem("spooler-sidebar:grouping:v1", "section");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("spooler-sidebar:grouping:v1", "section");
  vi.restoreAllMocks();
});

/** The deck rides above Inbox: bar → cards → Inbox region, in that order. */
function assertDeckAboveInbox(slot: RenderedSlot): void {
  const bar = slot.container.querySelector(".spooler-active-bar");
  expect(bar).not.toBeNull();
  const inbox = screen.getByRole("region", { name: "Inbox" });
  const after = inbox.compareDocumentPosition(bar!);
  expect(after & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
}

describe("active deck", () => {
  const sections = [makeSection({ id: "s1", name: "Backlog" })];

  function runningThread(over: Partial<PluginSidebarThread> = {}) {
    return makeThread({
      id: "runner",
      title: "Runner",
      status: "active",
      indicator: "runtime",
      sectionId: "s1",
      ...over,
    });
  }

  it("shows a top-bar Active section above Inbox with one duplicate card per running thread", () => {
    const slot = renderThreads([
      runningThread(),
      makeThread({ id: "quiet", sectionId: "s1" }),
      makeThread({ id: "idle", status: "idle" }),
    ], { sections });

    assertDeckAboveInbox(slot);
    // One card, for the one running thread only.
    const cards = slot.container.querySelectorAll(".spooler-active-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute("aria-label")).toBe("Runner, running in Backlog");
    // The bar carries the Zap rail label — scoped, because the lifecycle
    // switch also owns the word "Active".
    const label = slot.container.querySelector(
      ".spooler-active-bar .spooler-group-label",
    );
    expect(label?.textContent).toBe("Active");
    const pip = slot.container.querySelector(
      ".spooler-active-bar .spooler-pip-numeral",
    );
    expect(pip?.textContent).toBe("1");
    // The duplicate: the runner's own row still renders inside its section.
    expect(
      slot.container.querySelector('[data-sidebar-thread-id="runner"]'),
    ).not.toBeNull();
    expect(screen.getByRole("region", { name: "Backlog" })).toBeTruthy();
  });

  it("opens the original thread when its deck card is clicked", () => {
    const slot = renderThreads([runningThread(), makeThread({ id: "quiet" })], {
      sections,
    });
    const card = slot.container.querySelector<HTMLElement>(".spooler-active-card")!;
    fireEvent.click(card);
    const opened = slot.inspection.navigateCalls.filter(
      (call) => call.method === "toThread",
    );
    expect(opened).toHaveLength(1);
  });

  it("labels the card's origin with the spool title when the runner lives on a spool", async () => {
    const slot = renderThreads([
      runningThread({ id: "t1", title: "Lead-ish" }),
      runningThread({ id: "t2", title: "Member" }),
    ], {
      sections,
      sdk: sdkWithSpoolMetadata([
        { threadId: "t1", metadata: { spool: "spool_a", spoolJoined: 1, spoolLead: true } },
        { threadId: "t2", metadata: { spool: "spool_a", spoolJoined: 2 } },
      ]),
    });
    await act(async () => {});
    const labels = Array.from(
      slot.container.querySelectorAll(".spooler-active-card"),
    ).map((card) => card.getAttribute("aria-label"));
    expect(labels).toContain("Lead-ish, running in Spool: Lead-ish");
    expect(labels).toContain("Member, running in Spool: Lead-ish");
  });

  it("keeps the bar and every duplicate away in the unspooled, unfiltered views when nothing runs", () => {
    const slot = renderThreads([
      makeThread({ id: "quiet" }),
      makeThread({ id: "also-quiet" }),
    ], { sections });
    expect(slot.container.querySelector(".spooler-active-bar")).toBeNull();
    expect(
      slot.container.querySelectorAll(".spooler-active-card"),
    ).toHaveLength(0);
  });

  it("hides the deck (and its header offset) behind the setting", () => {
    const slot = renderThreads([runningThread(), makeThread({ id: "quiet" })], {
      sections,
      settings: { activeDeck: false },
    });
    expect(slot.container.querySelector(".spooler-active-bar")).toBeNull();
    const root = slot.container.querySelector(".spooler-list");
    expect(root?.classList.contains("spooler-list-active-bar")).toBe(false);
  });

  it("counts and flags attention states honestly in the bar pip", () => {
    const slot = renderThreads([
      runningThread({ id: "a", isUnread: true }),
      runningThread({ id: "b" }),
      makeThread({ id: "quiet" }),
    ], { sections });
    const pip = slot.container.querySelector(
      ".spooler-active-bar .spooler-pip-numeral",
    );
    expect(pip?.textContent).toBe("2");
    expect(
      slot.container.querySelector(
        ".spooler-active-bar .spooler-group-count-pip .spooler-group-status [data-icon-root]",
      ),
    ).not.toBeNull();
    const unread = slot.container.querySelector(
      ".spooler-active-bar .spooler-group-unread",
    );
    expect(unread?.textContent).toContain("1");
  });
});


