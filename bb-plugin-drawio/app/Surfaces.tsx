// bb-plugin-drawio — the host surfaces.
//
// Everything BB mounts, wired to the shared DiagramView:
//   DiagramsPanelBody    — the nav panel route body (subPath-routed editor
//                          or home), the main full-bleed editor surface
//   DiagramsSidebar      — the left sidebar while the panel route is active
//   DiagramsBrowserTab   — the panel's fixed right-panel tab (the browser)
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
import { DiagramsBrowser } from "./DiagramsBrowser.js";
import { HomeView } from "./HomeView.js";
import { Icon } from "@/components/ui/icon";

const TAB_REFERENCE = {
  id: "diagram",
  context: { kind: "nav-panel", panelId: PANEL_PATH },
  availability: "action",
} as const;

function openAsTab(panel: Pick<ExperimentalPanelController, "openTab">, ref: DocRef): void {
  panel.openTab({
    tab: TAB_REFERENCE,
    params: ref as unknown as JsonValue,
    title: docTitle(ref),
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={goHome}
        >
          <Icon name="ArrowLeft" className="size-3.5" />
          All diagrams
        </button>
      </div>
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
  const parsed = useMemo(() => parseSubPath(subPath), [subPath]);
  const current = parsed.ref !== null && parsed.ref.kind !== "draft" ? parsed.ref : null;

  const openRef = useCallback(
    (ref: DocRef) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(ref) });
    },
    [navigate],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <DiagramsBrowser variant="sidebar" onOpenRef={openRef} />
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
// Fixed right-panel tab: the browser
// ---------------------------------------------------------------------------

export function DiagramsBrowserTab(_props: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const openRef = useCallback(
    (ref: DocRef) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: refToSubPath(ref) });
    },
    [navigate],
  );
  const openTab = useCallback(
    (ref: DocRef) => {
      openAsTab(panel, ref);
    },
    [panel],
  );
  return <DiagramsBrowser variant="panel" onOpenRef={openRef} onOpenTab={openTab} />;
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
            Pick a diagram from the browser (fixed tab or the sidebar) to pin it here.
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
      className="min-h-0"
      onSavedAs={(ref) => openAsTab(panel, ref)}
    />
  );
}

// ---------------------------------------------------------------------------
// fileOpener: any .drawio file BB opens
// ---------------------------------------------------------------------------

export function FileOpenerEditor({ path, source }: PluginFileOpenerProps) {
  const refValue: DocRef = {
    kind: "file",
    source: normalizeSource({
      kind: source.kind,
      threadId: source.threadId,
      environmentId: source.environmentId,
      projectId: source.projectId,
      ...(source.experimental_hostId ? { hostId: source.experimental_hostId } : {}),
    }),
    path,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DiagramView refValue={refValue} className="min-h-0" />
    </div>
  );
}

// Typed params for the action tab registration (persisted JSON).
export const DIAGRAM_TAB_DEFAULT_PARAMS: DiagramTabParams = { kind: "home" };
