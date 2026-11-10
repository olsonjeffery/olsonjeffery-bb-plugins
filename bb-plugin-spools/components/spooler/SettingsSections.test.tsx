// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeList, fakeUpdate, fakeSectionsList, fakeSectionsCreate, fakeSectionsUpdate, fakeSectionsDelete, fakeSidebar, fakePluginId, fakePluginsList, fakeRealtime, sdkClient } = vi.hoisted(() => ({
  fakeList: vi.fn(),
  fakeUpdate: vi.fn(),
  fakeSectionsList: vi.fn(),
  fakeSectionsCreate: vi.fn(),
  fakeSectionsUpdate: vi.fn(),
  fakeSectionsDelete: vi.fn(),
  fakeSidebar: vi.fn(),
  fakePluginId: vi.fn(),
  fakePluginsList: vi.fn(),
  fakeRealtime: vi.fn(),
  sdkClient: { threads: null as any, threadSections: null as any, plugins: null as any },
}));
sdkClient.plugins = {
  list: fakePluginsList,
  install: vi.fn(),
};

/** One running thread-tags plugin row for the health card. */
const threadTagsRow = () => ({
  id: "thread-tags",
  enabled: true,
  status: "running",
  version: "0.1.0",
});
sdkClient.threads = {
  experimental_listPluginMetadata: fakeList,
  updatePluginMetadata: fakeUpdate,
};
sdkClient.threadSections = {
  list: fakeSectionsList,
  create: fakeSectionsCreate,
  update: fakeSectionsUpdate,
  delete: fakeSectionsDelete,
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
    // The Plugin-health card (the Thread Tags row) needs the shared app
    // surface; these bare renders run outside the runtime's slot context.
    useRealtime: fakeRealtime,
    useRealtimeConnectionState: () => "connected" as const,
  };
});

import { SpoolsSettingsSection } from "./SettingsSections";
import {
  THREAD_TAGS_PLUGIN_SOURCE,
  THREAD_TAGS_PLUGIN_URL,
} from "./threadTags";

var makeThread: (fixture: any) => any;
afterEach(() => cleanup());
beforeEach(async () => {
  localStorage.clear();
  fakeList.mockReset().mockResolvedValue({ threads: [] });
  fakeUpdate.mockReset().mockResolvedValue({});
  fakeSectionsList.mockReset().mockResolvedValue([
    { id: "sec-a", name: "Alpha", createdAt: 1, updatedAt: 1 },
    { id: "sec-b", name: "Beta", createdAt: 2, updatedAt: 2 },
  ]);
  fakeSectionsCreate.mockReset().mockResolvedValue({ id: "sec-new", name: "x", updatedThreadCount: 0 });
  fakeSectionsUpdate.mockReset().mockResolvedValue({ id: "sec-a", name: "x", updatedThreadCount: 0 });
  fakeSectionsDelete.mockReset().mockResolvedValue({ id: "sec-a", name: "x", updatedThreadCount: 0 });
  fakeSidebar.mockReset().mockReturnValue({ status: "ready", threads: [], projects: [], sections: [] });
  fakeRealtime.mockReset();
  fakePluginsList.mockReset().mockResolvedValue({ plugins: [threadTagsRow()] });
  sdkClient.plugins!.install = vi.fn().mockResolvedValue({ id: "thread-tags" });
  fakePluginId.mockReturnValue("spools");
  ({ makeThread: makeThread } = await import("./fixtures"));
});

const meta = (threadId: string, metadata: Record<string, unknown>) => ({ threadId, metadata });

describe("SpoolsSettingsSection — section editor", () => {
  it("has no spool list: the sidebar owns spool management", async () => {
    render(<SpoolsSettingsSection />);
    await waitFor(() => expect(screen.getByTestId("spooler-settings-section-name:sec-a")).toBeTruthy());
    expect(screen.queryByTestId("spooler-settings-spools")).toBeNull();
    expect(screen.queryByTestId("spooler-settings-no-spools")).toBeNull();
  });

  it("pins Inbox read-only above every server section, with counts", async () => {
    fakeSectionsList.mockResolvedValue([
      { id: "sec-a", name: "Alpha", createdAt: 1, updatedAt: 1 },
      { id: "sec-b", name: "Beta", createdAt: 2, updatedAt: 2 },
    ]);
    fakeSidebar.mockReturnValue({
      status: "ready",
      threads: [
        makeThread({ id: "t1", title: "One", sectionId: "sec-a" }),
        makeThread({ id: "t2", title: "Two", sectionId: "sec-a" }),
        makeThread({ id: "t3", title: "Three" }),
      ],
      projects: [],
      sections: [],
    });
    render(<SpoolsSettingsSection />);
    await waitFor(() => expect(screen.getByTestId("spooler-settings-section-name:sec-a")).toBeTruthy());
    const unfiled = screen.getByTestId("spooler-settings-section:unfiled");
    expect(unfiled.textContent).toContain("Inbox");
    expect(unfiled.textContent).toContain("read-only");
    expect(unfiled.querySelectorAll("button").length).toBe(0);
    expect(screen.queryByTestId("spooler-settings-delete:sec-b")).toBeTruthy();
    expect(screen.getByTestId("spooler-settings-section-name:sec-a").textContent).toBe("Alpha");
  });

  it("renames a section through threadSections.update", async () => {
    render(<SpoolsSettingsSection />);
    fireEvent.click(await screen.findByTestId("spooler-settings-rename:sec-a"));
    const input = screen.getByTestId("spooler-settings-rename-input:sec-a");
    fireEvent.change(input, { target: { value: "Alpha renamed" } });
    fireEvent.click(screen.getByTestId("spooler-settings-rename-save:sec-a"));
    await waitFor(() =>
      expect(fakeSectionsUpdate).toHaveBeenCalledWith({ id: "sec-a", name: "Alpha renamed" }),
    );
    await waitFor(() => expect(fakeSectionsList).toHaveBeenCalledTimes(2));
  });

  it("deletes a section only after an inline confirm; threads are said to stay", async () => {
    render(<SpoolsSettingsSection />);
    fireEvent.click(await screen.findByTestId("spooler-settings-delete:sec-b"));
    expect(fakeSectionsDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("spooler-settings-delete-go:sec-b"));
    await waitFor(() => expect(fakeSectionsDelete).toHaveBeenCalledWith({ id: "sec-b" }));
    expect(screen.queryByTestId("spooler-settings-delete-go:sec-b")).toBeNull();
  });

  it("creates a section and reloads the list", async () => {
    render(<SpoolsSettingsSection />);
    fireEvent.click(await screen.findByTestId("spooler-settings-new-trigger"));
    fireEvent.change(screen.getByTestId("spooler-settings-new-input"), {
      target: { value: "Gamma" },
    });
    fireEvent.click(screen.getByTestId("spooler-settings-new-create"));
    await waitFor(() =>
      expect(fakeSectionsCreate).toHaveBeenCalledWith({ name: "Gamma" }),
    );
    await waitFor(() => expect(fakeSectionsList).toHaveBeenCalledTimes(2));
  });

  it("keeps no colour editor: section identity is icon-only", async () => {
    render(<SpoolsSettingsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("spooler-settings-section-name:sec-a")).toBeTruthy(),
    );
    expect(screen.queryByTestId("spooler-settings-swatch:sec-a")).toBeNull();
    expect(screen.queryByTestId("spooler-settings-colorstrip:sec-a")).toBeNull();
  });
});

describe("SpoolsSettingsSection — Plugin health (Thread Tags)", () => {
  it("reads green when Thread Tags runs, with state and version", async () => {
    render(<SpoolsSettingsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("spooler-settings-thread-tags")).toBeTruthy(),
    );
    const row = screen.getByTestId("spooler-settings-thread-tags");
    expect(row.textContent).toContain("Running · v0.1.0");
    expect(row.getAttribute("aria-label") ?? row.textContent).not.toContain("Not available");
    expect(screen.queryByTestId("spooler-settings-thread-tags-install")).toBeNull();
  });

  it("offers the one-click install while the plugin is missing, through the pinned source", async () => {
    fakePluginsList.mockResolvedValue({ plugins: [] });
    render(<SpoolsSettingsSection />);
    const button = await screen.findByTestId("spooler-settings-thread-tags-install");
    expect(screen.getByTestId("spooler-settings-thread-tags").textContent).toContain("Not installed");
    fireEvent.click(button);
    await waitFor(() =>
      expect(sdkClient.plugins!.install).toHaveBeenCalledWith({
        source: THREAD_TAGS_PLUGIN_SOURCE,
      }),
    );
    // The install changed the plugin list: the card re-reads on the spot.
    await waitFor(() => expect(fakePluginsList.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("falls back to the bare URL when the pinned install source is rejected", async () => {
    fakePluginsList.mockResolvedValue({ plugins: [] });
    sdkClient.plugins!.install = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported source"))
      .mockResolvedValue({ id: "thread-tags" });
    render(<SpoolsSettingsSection />);
    fireEvent.click(await screen.findByTestId("spooler-settings-thread-tags-install"));
    await waitFor(() =>
      expect(sdkClient.plugins!.install).toHaveBeenLastCalledWith({
        source: THREAD_TAGS_PLUGIN_URL,
      }),
    );
  });

  it("shows a disabled install without the button, so the user enables it in the list", async () => {
    fakePluginsList.mockResolvedValue({
      plugins: [{ id: "thread-tags", enabled: false, status: "disabled", version: "0.1.0" }],
    });
    render(<SpoolsSettingsSection />);
    const row = await screen.findByTestId("spooler-settings-thread-tags");
    expect(row.textContent).toContain("Installed — disabled");
    expect(screen.queryByTestId("spooler-settings-thread-tags-install")).toBeNull();
  });
});
