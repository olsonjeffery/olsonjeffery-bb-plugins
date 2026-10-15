// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeList, fakeUpdate, fakeThreadUpdate, fakeSidebar, fakePluginId, sdkClient } = vi.hoisted(() => ({
  fakeList: vi.fn(),
  fakeUpdate: vi.fn(),
  fakeThreadUpdate: vi.fn(),
  fakeSidebar: vi.fn(),
  fakePluginId: vi.fn(),
  sdkClient: { threads: null as any },
}));
sdkClient.threads = {
  experimental_listPluginMetadata: fakeList,
  updatePluginMetadata: fakeUpdate,
  update: fakeThreadUpdate,
};

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const actual = await vi.importActual<typeof import("@get-bb/plugin-sdk/app")>(
    "@get-bb/plugin-sdk/app",
  );
  return {
    ...actual,
    experimental_usePluginId: fakePluginId,
    experimental_useSidebarThreads: fakeSidebar,
    useSdk: () => sdkClient,
  };
});

import { MoveToSectionPanel, ThrowOntoSpoolPanel } from "./PalettePanels";

var makeThread: (fixture: any) => any;
afterEach(() => cleanup());
beforeEach(async () => {
  fakeList.mockReset().mockResolvedValue({ threads: [] });
  fakeUpdate.mockReset().mockResolvedValue({});
  fakeThreadUpdate.mockReset().mockResolvedValue({});
  fakeSidebar.mockReset();
  fakePluginId.mockReturnValue("spools");
  ({ makeThread: makeThread } = await import("./fixtures"));
});

const renderPanels = () => ({
  moveToSection: () =>
    render(<MoveToSectionPanel threadId="t1" params={null} />),
  throwOntoSpool: () => render(<ThrowOntoSpoolPanel threadId="t1" params={null} />),
});

const meta = (threadId: string, metadata: Record<string, unknown>) => ({ threadId, metadata });

describe("MoveToSectionPanel", () => {
  it("lists Unfiled first plus every section and files the thread on pick", async () => {
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [makeThread({ id: "t1", title: "Alpha" })],
      projects: [],
      sections: [{ id: "sec-a", name: "Alpha Section", createdAt: 1, updatedAt: 1 }],
    });
    const view = renderPanels().moveToSection();
    expect(
      await screen.findByTestId("spooler-move-section:sec-a"),
    ).toBeTruthy();
    expect(screen.getByTestId("spooler-move-section:unfiled")).toBeTruthy();
    fireEvent.click(screen.getByTestId("spooler-move-section:sec-a"));
    await waitFor(() =>
      expect(fakeThreadUpdate).toHaveBeenCalledWith({ threadId: "t1", sectionId: "sec-a" }),
    );
    expect(await screen.findByTestId("spooler-palette-result").then((node) => node.textContent))
      .toContain("Moved thread to Alpha Section.");
    expect(view).toBeTruthy();
  });

  it("files Unfiled with sectionId null", async () => {
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [makeThread({ id: "t1", title: "Alpha", sectionId: "sec-a" })],
      projects: [],
      sections: [{ id: "sec-a", name: "Alpha Section", createdAt: 1, updatedAt: 1 }],
    });
    renderPanels().moveToSection();
    fireEvent.click(screen.getByTestId("spooler-move-section:unfiled"));
    await waitFor(() =>
      expect(fakeThreadUpdate).toHaveBeenCalledWith({ threadId: "t1", sectionId: null }),
    );
  });

  it("moves the whole spool when the thread is a member and skips stale moves", async () => {
    fakeList.mockResolvedValue({
      threads: [
        meta("t1", { spool: "spool_a", spoolJoined: 10, spoolLead: true }),
        meta("t2", { spool: "spool_a", spoolJoined: 20 }),
      ],
    });
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [
        makeThread({ id: "t1", title: "Alpha", sectionId: "sec-old" }),
        makeThread({ id: "t2", title: "Beta", sectionId: "sec-a" }),
      ],
      projects: [],
      sections: [{ id: "sec-a", name: "Alpha Section", createdAt: 1, updatedAt: 1 }],
    });
    const view = renderPanels().moveToSection();
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid="spooler-move-to-section"]')?.getAttribute("data-status")).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("spooler-move-section:sec-a"));
    await waitFor(() => expect(fakeThreadUpdate).toHaveBeenCalledTimes(1));
    // t2 already sits in sec-a — only the stale member moves.
    expect(fakeThreadUpdate).toHaveBeenCalledWith({ threadId: "t1", sectionId: "sec-a" });
    expect(screen.getByTestId("spooler-palette-result").textContent).toContain("(1 thread)");
  });
});

describe("ThrowOntoSpoolPanel", () => {
  it("lists New spool plus existing spools and reuses the spool store mutations", async () => {
    fakeList.mockResolvedValue({
      threads: [meta("t2", { spool: "spool_a", spoolJoined: 10, spoolLead: true })],
    });
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [makeThread({ id: "t1", title: "Alpha" }), makeThread({ id: "t2", title: "Beta" })],
      projects: [],
      sections: [],
    });
    renderPanels().throwOntoSpool();
    expect(await screen.findByTestId("spooler-throw-spool:new")).toBeTruthy();
    expect(screen.getByTestId("spooler-throw-spool:spool_a")).toBeTruthy();
    expect(screen.getByTestId("spooler-throw-spool:spool_a").textContent).toContain("Spool: Beta");
    fireEvent.click(screen.getByTestId("spooler-throw-spool:spool_a"));
    await waitFor(() =>
      expect(fakeUpdate).toHaveBeenCalledTimes(1),
    );
    expect(fakeUpdate.mock.calls[0][0]).toMatchObject({
      threadId: "t1",
      pluginId: "spools",
      set: { spool: "spool_a", spoolLead: false },
    });
  });

  it("guards picking a spool the thread already belongs to", async () => {
    fakeList.mockResolvedValue({
      threads: [meta("t1", { spool: "spool_a", spoolJoined: 10, spoolLead: true })],
    });
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [makeThread({ id: "t1", title: "Alpha" })],
      projects: [],
      sections: [],
    });
    const view = renderPanels().throwOntoSpool();
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid="spooler-throw-onto-spool"]')?.getAttribute("data-status")).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("spooler-throw-spool:spool_a"));
    await waitFor(() =>
      expect(screen.getByTestId("spooler-palette-result").textContent).toContain(
        "Already in that spool.",
      ),
    );
    expect(fakeUpdate).not.toHaveBeenCalled();
    expect(fakeThreadUpdate).not.toHaveBeenCalled();
  });
});
