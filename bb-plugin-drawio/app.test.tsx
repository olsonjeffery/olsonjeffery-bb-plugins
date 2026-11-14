// bb-plugin-drawio — frontend surfaces over the app testing runtime: the
// registrations validate, the home posture reacts to configuration, the
// browser lists vault diagrams over RPC, deep links land on the editor with
// the whole header collapsed into one toolbar row (back control included),
// sidebar surfaces render the read-only viewer with the dashboard handoff,
// and the toolbar lifts the surface to the viewport.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { refToSubPath, viewerSrcDoc } from "./app/drawio.js";

const RPC = {
  "config.status": () => ({
    configured: true,
    instanceUrl: "http://draw.example.com",
    docsAvailable: true,
    defaultVaultId: "",
    defaultFolder: "diagrams",
    uiTheme: "min",
  }),
  "vault.list": () => ({
    vaults: [{ id: "v1", name: "Personal", rootPath: "/notes", hostId: null }],
  }),
  "vault.files": () => ({
    files: [
      { path: "diagrams/flow.drawio", sha256: "s1", sizeBytes: 10, modifiedAtMs: 1_000_000 },
      { path: "diagrams/nested/plan.drawio", sha256: "s2", sizeBytes: 10, modifiedAtMs: 2_000_000 },
      { path: "notes/todo.md", sha256: "s3", sizeBytes: 5, modifiedAtMs: 3_000_000 },
    ],
    refreshedAtMs: 9,
    stale: false,
  }),
  "drafts.list": () => ({ drafts: [] }),
  "vault.read": () => ({ content: "<mxfile/>", sha256: "sha", modifiedAtMs: 1 }),
  "workspace.read": () => ({ content: "<mxfile/>", sha256: "sha", modifiedAtMs: 1 }),
  "drafts.get": () => ({ draft: null }),
};

const SETTINGS = { instanceUrl: "http://draw.example.com" };

async function loadApp() {
  return loadPluginApp(() => import("./app"));
}

describe("drawio frontend", () => {
  it("registers the expected surfaces", async () => {
    const app = await loadApp();
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({ id: "diagrams", title: "Diagrams", path: "diagrams" });
    const navTabs = app.tabs.filter((tab) => tab.context.kind === "nav-panel");
    // The Draw.io Browser is an addable window type (action tab), not a fixed
    // destination; the drawio-only fixed browser is gone.
    expect(navTabs.map((tab) => `${tab.id}:${tab.availability}`)).toEqual(["browser:action", "diagram:action"]);
    // Threads get the browser launcher plus an inline-diagram tab that is
    // opened only from the browser (no launcher of its own).
    const threadTabs = app.tabs.filter((tab) => tab.context.kind === "thread");
    expect(threadTabs.map((tab) => `${tab.id}:${tab.availability}`)).toEqual(["browser:action", "diagram:action"]);
    expect(app.threadActions).toHaveLength(1);
    expect(app.threadActions[0]).toMatchObject({ id: "drawio-browser", placement: "header" });
    expect(app.fileOpeners).toHaveLength(1);
    expect(app.fileOpeners[0]).toMatchObject({ id: "drawio", extensions: ["drawio"] });
  });

  it("home lists recent vault diagrams", async () => {
    const app = await loadApp();
    const slot = await renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: RPC, settings: SETTINGS });
    await slot.findByText("Recent vault diagrams");
    await slot.findByText("diagrams/flow.drawio");
    slot.lifecycle.unmount();
  });

  it("home shows the setup hint without an instance", async () => {
    const app = await loadApp();
    const slot = await renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: RPC, settings: { instanceUrl: "" } },
    );
    await slot.findByText(/Set up your draw\.io instance/);
    slot.lifecycle.unmount();
  });

  it("the sidebar browser lists every vault file type with delete actions", async () => {
    const app = await loadApp();
    const sidebar = app.navPanels[0]!.experimental_sidebar;
    expect(sidebar).toBeDefined();
    // renderSlot takes a registration shape; wrap the raw component.
    const slot = await renderSlot(
      { component: sidebar! },
      { subPath: "" },
      { rpc: RPC, settings: SETTINGS },
    );
    await slot.findByText("New diagram");
    await slot.findByText("flow.drawio");
    // Non-diagram vault files are listed too, and every row carries actions.
    await slot.findByText("todo.md");
    await slot.findByLabelText("Actions for flow.drawio");
    await slot.findByLabelText("Actions for todo.md");
    slot.lifecycle.unmount();
  });

  it("a deep link renders the editor shell for that document", async () => {
    const app = await loadApp();
    const subPath = refToSubPath({ kind: "vault", vaultId: "v1", path: "diagrams/flow.drawio" });
    const slot = await renderSlot(
      app.navPanels[0]!,
      { subPath },
      { rpc: RPC, settings: SETTINGS },
    );
    // The editor shell loads the document; the iframe itself cannot connect
    // in jsdom, but the toolbar and its connect overlay render.
    await slot.findByText("flow.drawio");
    await slot.findByText("Save");
    // One header row: the back control lives IN the toolbar (the standalone
    // back bar is gone), so "All diagrams" appears exactly once.
    expect(slot.getAllByText("All diagrams")).toHaveLength(1);
    slot.lifecycle.unmount();
  });

  it("the toolbar's back control returns to the diagram list", async () => {
    const app = await loadApp();
    const subPath = refToSubPath({ kind: "vault", vaultId: "v1", path: "diagrams/flow.drawio" });
    const slot = await renderSlot(
      app.navPanels[0]!,
      { subPath },
      { rpc: RPC, settings: SETTINGS },
    );
    await slot.findByText("flow.drawio");
    fireEvent.click(slot.getByRole("button", { name: "All diagrams" }));
    expect(slot.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "diagrams", options: { subPath: "" } },
    ]);
    slot.lifecycle.unmount();
  });

  it("the read-only viewer frame is built from the static viewer bundle", () => {
    const doc = viewerSrcDoc(
      "http://draw.example.com:12300",
      '<mxfile><diagram id="1" name="Page-1">a &amp; b</diagram></mxfile>',
    );
    expect(doc).toContain("viewer.min.js");
    expect(doc).toContain('window.DRAWIO_BASE_URL="http://draw.example.com:12300"');
    // Parse the frame document back: the config must round-trip through the
    // HTML attribute exactly (quotes and entity references in the XML too).
    const frame = new DOMParser().parseFromString(doc, "text/html");
    const config = JSON.parse(frame.querySelector("div.mxgraph")!.getAttribute("data-mxgraph")!);
    expect(config).toMatchObject({
      "auto-fit": true,
      "allow-zoom-in": true,
      "check-visible-state": false,
      resize: false,
      toolbar: "zoom pages",
    });
    expect(config.xml).toContain("a &amp; b");
  });

  it("viewerSrcDoc rejects an unconfigured instance", () => {
    expect(viewerSrcDoc("   ", "<mxfile/>")).toBeNull();
    expect(viewerSrcDoc("not a url", "<mxfile/>")).toBeNull();
  });

  it("thread diagram tabs render the read-only viewer with the dashboard handoff", async () => {
    const app = await loadApp();
    const tab = app.tabs.find((entry) => entry.context.kind === "thread" && entry.id === "diagram");
    expect(tab).toBeDefined();
    const slot = await renderSlot(
      { component: tab!.component },
      { threadId: "t1", params: { kind: "vault", vaultId: "v1", path: "diagrams/flow.drawio" } },
      { rpc: RPC, settings: SETTINGS },
    );
    await slot.findByText("flow.drawio");
    // The frame is the static viewer document, not the embed editor.
    const frame = slot.container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("srcdoc")).toContain("data-mxgraph");
    expect(frame!.getAttribute("srcdoc")).toContain("viewer.min.js");
    // No editing surface: no Save/Export; a reload plus the handoff instead.
    expect(slot.queryByText("Save")).toBeNull();
    expect(slot.queryByText("Export")).toBeNull();
    await slot.findByLabelText("Reload from disk");
    const openInEditor = await slot.findByText("Open in editor");
    fireEvent.click(openInEditor);
    expect(slot.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "diagrams",
        options: { subPath: refToSubPath({ kind: "vault", vaultId: "v1", path: "diagrams/flow.drawio" }) },
      },
    ]);
    slot.lifecycle.unmount();
  });

  it("the fileOpener renders the read-only viewer for opened files", async () => {
    const app = await loadApp();
    const opener = app.fileOpeners[0]!;
    const slot = await renderSlot(
      { component: opener.component },
      {
        path: "arch/flow.drawio",
        source: { kind: "thread-storage", threadId: "t1", environmentId: null, projectId: null },
      },
      { rpc: RPC, settings: SETTINGS },
    );
    await slot.findByText("flow.drawio");
    const frame = slot.container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("srcdoc")).toContain("data-mxgraph");
    expect(slot.queryByText("Save")).toBeNull();
    await slot.findByText("Open in editor");
    slot.lifecycle.unmount();
  });

  it("the toolbar lifts the surface to the viewport (CSS fallback in jsdom)", async () => {
    const app = await loadApp();
    const subPath = refToSubPath({ kind: "vault", vaultId: "v1", path: "diagrams/flow.drawio" });
    const slot = await renderSlot(
      app.navPanels[0]!,
      { subPath },
      { rpc: RPC, settings: SETTINGS },
    );
    await slot.findByText("flow.drawio");
    fireEvent.click(slot.getByRole("button", { name: "Fullscreen" }));
    // jsdom has no Fullscreen API, so the fixed-overlay fallback applies...
    const lifted = slot.getByRole("button", { name: "Exit fullscreen" }).closest(".inset-0");
    expect(lifted).not.toBeNull();
    expect(lifted!.className).toContain("fixed");
    expect(lifted!.className).toContain("z-40");
    // ...and toggling again puts it back inline.
    fireEvent.click(slot.getByRole("button", { name: "Exit fullscreen" }));
    expect(slot.getByRole("button", { name: "Fullscreen" })).toBeDefined();
    expect(slot.container.querySelector(".fixed.inset-0")).toBeNull();
    slot.lifecycle.unmount();
  });
});
