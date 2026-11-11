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
  DIAGRAM_TAB_DEFAULT_PARAMS,
  DiagramActionTab,
  DiagramsBrowserTab,
  DiagramsPanelBody,
  DiagramsSidebar,
  FileOpenerEditor,
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

  // The browser as a fixed right-panel tab: open a second diagram beside the
  // body view, or browse while the body stays on the home state.
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: PANEL_PATH },
    availability: "fixed",
    id: "browser",
    title: "Diagrams",
    icon: "FolderOpen",
    component: DiagramsBrowserTab,
    layout: "flush",
  });

  // One tab per open diagram; params identify the document and persist
  // across restarts.
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: PANEL_PATH },
    availability: "action",
    id: "diagram",
    title: "Diagram",
    icon: "Workflow",
    component: DiagramActionTab,
    params: DIAGRAM_TAB_DEFAULT_PARAMS,
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
