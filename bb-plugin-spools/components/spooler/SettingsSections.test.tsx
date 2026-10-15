// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeList, fakeUpdate, fakeSectionsList, fakeSectionsCreate, fakeSectionsUpdate, fakeSectionsDelete, fakeSidebar, fakePluginId, sdkClient } = vi.hoisted(() => ({
  fakeList: vi.fn(),
  fakeUpdate: vi.fn(),
  fakeSectionsList: vi.fn(),
  fakeSectionsCreate: vi.fn(),
  fakeSectionsUpdate: vi.fn(),
  fakeSectionsDelete: vi.fn(),
  fakeSidebar: vi.fn(),
  fakePluginId: vi.fn(),
  sdkClient: { threads: null as any, threadSections: null as any },
}));
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
  };
});

import { SpoolsSettingsSection } from "./SettingsSections";

var makeThread: (fixture: any) => any;
afterEach(() => cleanup());
beforeEach(async () => {
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

  it("pins Unfiled read-only above every server section, with counts", async () => {
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
    expect(unfiled.textContent).toContain("Unfiled");
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
    fireEvent.change(await screen.findByTestId("spooler-settings-new-input"), {
      target: { value: "Gamma" },
    });
    fireEvent.click(screen.getByTestId("spooler-settings-new-create"));
    await waitFor(() =>
      expect(fakeSectionsCreate).toHaveBeenCalledWith({ name: "Gamma" }),
    );
    await waitFor(() => expect(fakeSectionsList).toHaveBeenCalledTimes(2));
  });
});
