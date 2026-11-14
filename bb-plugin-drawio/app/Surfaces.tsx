// bb-plugin-drawio — the host surfaces.
//
// Everything BB mounts, wired to the shared DiagramView:
//   DiagramsPanelBody    — the nav panel route body (subPath-routed editor
//                          or home), the main full-bleed editor surface
//   DiagramsSidebar      — the left sidebar while the panel route is active
//   VaultBrowserTab      — the "Vault browser" right-panel window type
//                          (addable from the panel's New-tab menu; closable)
//   DiagramActionTab     — one open diagram per action tab, params persisted
//   FileOpenerEditor     — any .drawio file BB opens (file picker, markdown
//                          links, bb thread open)
import { useCallback, useMemo } from "react";
import { useBbNavigate, experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import type {
  PluginNavPanelProps,
  PluginFileOpenerProps,
  ExperimentalPanelController,
} from "@get-bb/plugin-sdk/app";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { DiagramTabParams, DocRef } from "../contract.js";
import {
  docTitle,
  draftToSubPath,
  normalizeSource,
  parseSubPath,
  parseTabParams,
  refToSubPath,
  PANEL_PATH,
} from "./drawio.js";
import { DiagramView } from "./DiagramView.js";
import { VaultBrowser } from "./VaultBrowser.js";
import { HomeView } from "./HomeView.js";

const DIAGRAM_TAB_REFERENCE = {
  id: "diagram",
  context: { kind: "nav-panel", panelId: PANEL_PATH },
  availability: "action",
} as const;

const THREAD_DIAGRAM_TAB_REFERENCE = {
  id: "diagram",
  context: { kind: "thread" },
  availability: "action",
} as const;

const THREAD_BROWSER_TAB_REFERENCE = {
  id: "browser",
  context: { kind: "thread" },
  availability: "action",
} as const;

type TabSurface = "nav-panel" | "thread";

function openAsTab(
  panel: Pick<ExperimentalPanelController, "openTab">,
  ref: DocRef,
  surface: TabSurface = "nav-panel",
): boolean {
  return panel.openTab({
    tab: surface === "thread" ? THREAD_DIAGRAM_TAB_REFERENCE : DIAGRAM_TAB_REFERENCE,
    params: ref as unknown as JsonValue,
    title: docTitle(ref),
  });
}

function openBrowserTab(
  panel: Pick<ExperimentalPanelController, "openTab">,
  surface: TabSurface,
): void {
  panel.openTab({
    tab: surface === "thread" ? THREAD_BROWSER_TAB_REFERENCE : { ...THREAD_BROWSER_TAB_REFERENCE, context: { kind: "nav-panel", panelId: PANEL_PATH } },
    params: BROWSER_TAB_DEFAULT_PARAMS as unknown as JsonValue,
    title: "Draw.io Browser",
  });
}

// ---------------------------------------------------------------------------
// Panel body
// ---------------------------------------------------------------------------

export function DiagramsPanelBody({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const parsed = useMemo(() => parseSubPath(subPath), [subPath]);

  const openRef = useCallback(
    (ref: DocRef) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(ref) });
    },
    [navigate],
  );
  const openDraft = useCallback(
    (draftKey: string) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: draftToSubPath(draftKey) });
    },
    [navigate],
  );
  const goHome = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  }, [navigate]);

  const refValue = parsed.ref;
  if (refValue === null) {
    return <HomeView onOpenRef={openRef} onOpenDraft={openDraft} />;
  }
  // One header row: the document toolbar carries the "← All diagrams" back
  // control (onBack doubles as the dead-link escape hatch), so nothing sits
  // between bb's panel header and the diagram.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DiagramView
        refValue={refValue}
        className="min-h-0"
        onSavedAs={(ref) => {
          // After Save As, the body re-targets to the saved document.
          openRef(ref);
        }}
        onBack={goHome}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left sidebar while the panel route is active
// ---------------------------------------------------------------------------

export function DiagramsSidebar({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const parsed = useMemo(() => parseSubPath(subPath), [subPath]);
  const current = parsed.ref !== null && parsed.ref.kind !== "draft" ? parsed.ref : null;

  const openRef = useCallback(
    (ref: DocRef) => {
      // Always a tab; if this surface has no accepting panel (the sidebar can
      // render outside the panel host), fall back to the body route.
      if (!openAsTab(panel, ref)) {
        navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(ref) });
      }
    },
    [navigate, panel],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <VaultBrowser variant="sidebar" onOpenDiagram={openRef} />
      </div>
      {current !== null ? (
        <div className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
          <span className="truncate">Open: {docTitle(current)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Vault browser" window type: an addable, closable right-panel tab
// ---------------------------------------------------------------------------

export function VaultBrowserTab(_props: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const openRef = useCallback(
    (ref: DocRef) => {
      // Always open in a tab beside the browser; the body route is the
      // fallback if the panel declines.
      if (!openAsTab(panel, ref)) {
        navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(ref) });
      }
    },
    [navigate, panel],
  );
  return <VaultBrowser variant="panel" onOpenDiagram={openRef} />;
}

// ---------------------------------------------------------------------------
// Action tab: one open diagram per tab
// ---------------------------------------------------------------------------

export function DiagramActionTab({ params }: PluginNavPanelProps & { params: unknown }) {
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const parsed = useMemo(() => parseTabParams(params), [params]);

  if (parsed === null || parsed.kind === "home" || parsed.kind === "draft") {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-4">
          <p className="text-xs text-muted-foreground">
            Pick a diagram from the vault browser (window tab or the sidebar) to pin it here.
          </p>
          <HomeView
            onOpenRef={(ref) => openAsTab(panel, ref)}
            onOpenDraft={(draftKey) => {
              // Drafts open in the main body, where Save As lives.
              navigate.toPluginPanel(PANEL_PATH, { subPath: draftToSubPath(draftKey) });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <DiagramView
      refValue={parsed as DocRef}
      compact
      className="h-full"
      onSavedAs={(ref) => openAsTab(panel, ref)}
    />
  );
}

// ---------------------------------------------------------------------------
// Thread tabs: the browser and inline diagrams beside a thread's transcript
// ---------------------------------------------------------------------------

/**
 * The browser inside a thread's right panel: clicking a diagram opens it as a
 * sibling tab in the SAME panel (never the plugin page — that would yank the
 * user out of the thread).
 */
export function ThreadBrowserTab(_props: { threadId: string }) {
  const panel = experimental_useAppPanel();
  const openInThread = useCallback(
    (ref: DocRef) => {
      openAsTab(panel, ref, "thread");
    },
    [panel],
  );
  return <VaultBrowser variant="panel" onOpenDiagram={openInThread} />;
}

/**
 * One open diagram beside a thread; opened from the thread's browser. Read-only
 * — sidebar surfaces never edit; the toolbar hands off to the dashboard.
 */
export function ThreadDiagramTab({ params }: { threadId: string; params: unknown }) {
  const navigate = useBbNavigate();
  const parsed = useMemo(() => parseTabParams(params), [params]);

  const openInDashboard = useCallback(() => {
    if (parsed === null || (parsed.kind !== "vault" && parsed.kind !== "file")) return;
    // The plugin page's body route is the editable dashboard surface; this
    // moves the main body there and leaves the thread's tab as it is.
    navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(parsed as DocRef) });
  }, [navigate, parsed]);

  if (parsed === null || (parsed.kind !== "vault" && parsed.kind !== "file")) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-4">
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Open the Draw.io Browser from this panel's New-tab menu (or the thread header's
          Diagram button) and pick a diagram to pin it here.
        </p>
      </div>
    );
  }

  return (
    <DiagramView
      refValue={parsed as DocRef}
      compact
      className="h-full"
      readOnly
      onOpenInEditor={openInDashboard}
    />
  );
}

/** Thread header button: opens the browser in the thread's own panel. */
export function openThreadBrowserFromAction(panel: Pick<ExperimentalPanelController, "openTab">): boolean {
  return panel.openTab({
    tab: THREAD_BROWSER_TAB_REFERENCE,
    params: BROWSER_TAB_DEFAULT_PARAMS as unknown as JsonValue,
    title: "Draw.io Browser",
  });
}

// ---------------------------------------------------------------------------
// fileOpener: any .drawio file BB opens
// ---------------------------------------------------------------------------

/**
 * Any `.drawio` file BB opens — the file picker, a markdown link, `bb thread
 * open` — renders the read-only viewer. A sidebar open can look, reload, and
 * hand off to the dashboard, but never edit.
 */
export function FileOpenerEditor({ path, source }: PluginFileOpenerProps) {
  const navigate = useBbNavigate();
  const refValue: DocRef = useMemo(
    () => ({
      kind: "file",
      source: normalizeSource({
        kind: source.kind,
        threadId: source.threadId,
        environmentId: source.environmentId,
        projectId: source.projectId,
        ...(source.experimental_hostId ? { hostId: source.experimental_hostId } : {}),
      }),
      path,
    }),
    [path, source],
  );
  const openInDashboard = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(refValue) });
  }, [navigate, refValue]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DiagramView
        refValue={refValue}
        className="min-h-0"
        readOnly
        onOpenInEditor={openInDashboard}
      />
    </div>
  );
}

// Typed params for the browser window tab (persisted JSON).
export const BROWSER_TAB_DEFAULT_PARAMS: DiagramTabParams = { kind: "home" };

// Typed params for the diagram action tab (persisted JSON).
export const DIAGRAM_TAB_DEFAULT_PARAMS: DiagramTabParams = { kind: "home" };
