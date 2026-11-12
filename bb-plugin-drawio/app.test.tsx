// bb-plugin-drawio — frontend surfaces over the app testing runtime: the
// registrations validate, the home posture reacts to configuration, the
// browser lists vault diagrams over RPC, and deep links land on the editor.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { refToSubPath } from "./app/drawio.js";

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
    const tabs = app.tabs.filter((tab) => tab.context.kind === "nav-panel");
    // The vault browser is an addable window type (action tab), not a fixed
    // destination; the drawio-only fixed browser is gone.
    expect(tabs.map((tab) => `${tab.id}:${tab.availability}`)).toEqual(["browser:action", "diagram:action"]);
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
    slot.lifecycle.unmount();
  });
});
