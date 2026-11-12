// bb-plugin-drawio — frontend entry.
//
// The embedded draw.io editor surfaces:
//   - a "Diagrams" nav panel (rail item + full-bleed page): the body routes
//     by subPath between the home state and the editor for one document,
//   - a left sidebar (experimental_sidebar) with the vault/file browser while
//     that route is active,
//   - a fixed right-panel tab with the same browser, so a diagram can be
//     opened beside whatever the body shows,
//   - one action tab per open diagram (persisted params; several at once),
//   - a fileOpener: every .drawio file BB opens — file picker, markdown
//     links, bb thread open — renders in the same embedded editor.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  BROWSER_TAB_DEFAULT_PARAMS,
  DIAGRAM_TAB_DEFAULT_PARAMS,
  DiagramActionTab,
  DiagramsPanelBody,
  DiagramsSidebar,
  FileOpenerEditor,
  ThreadBrowserTab,
  ThreadDiagramTab,
  VaultBrowserTab,
  openThreadBrowserFromAction,
} from "./app/Surfaces.js";
import { PANEL_PATH } from "./app/drawio.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "diagrams",
    title: "Diagrams",
    icon: "Workflow",
    path: PANEL_PATH,
    component: DiagramsPanelBody,
    experimental_sidebar: DiagramsSidebar,
  });

  // The Draw.io Browser as an addable, closable right-panel window type
  // (panel New-tab menu): browse everything in the vault beside whatever the
  // body shows.
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: PANEL_PATH },
    availability: "action",
    id: "browser",
    title: "Draw.io Browser",
    icon: "FolderOpen",
    component: VaultBrowserTab,
    params: BROWSER_TAB_DEFAULT_PARAMS,
    layout: "flush",
  });

  // One tab per open diagram; params identify the document and persist
  // across restarts. Flush so the embedded editor spans the panel height.
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: PANEL_PATH },
    availability: "action",
    id: "diagram",
    title: "Diagram",
    icon: "Workflow",
    component: DiagramActionTab,
    params: DIAGRAM_TAB_DEFAULT_PARAMS,
    layout: "flush",
  });

  // Inside threads: the browser (launcher in the thread panel's New-tab menu)
  // and one inline-diagram tab per opened document (opened from the browser,
  // so no launcher of its own).
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "browser",
    title: "Draw.io Browser",
    icon: "FolderOpen",
    component: ThreadBrowserTab,
    params: BROWSER_TAB_DEFAULT_PARAMS,
    layout: "flush",
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "diagram",
    title: "Diagram",
    icon: "Workflow",
    component: ThreadDiagramTab,
    layout: "flush",
    useVisible: () => false,
  });

  // A Diagram button in the thread header: opens/focuses the browser in the
  // thread's own panel (same tab instance the New-tab menu opens).
  app.slots.experimental_threadAction({
    id: "drawio-browser",
    title: "Diagram",
    icon: "Workflow",
    group: "open",
    placement: "header",
    item: ({ experimental_panel }) => ({
      label: "Diagram",
      icon: "Workflow",
      run: () => {
        openThreadBrowserFromAction(experimental_panel);
      },
    }),
  });

  // Any .drawio file bb opens renders in the embedded editor with
  // CAS-guarded saves against the file's own source.
  app.slots.fileOpener({
    id: "drawio",
    title: "draw.io editor",
    extensions: ["drawio"],
    component: FileOpenerEditor,
  });
});
