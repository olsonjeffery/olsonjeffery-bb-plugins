// bb-plugin-personas — frontend entry.
//
// A persistent left rail of personas (PersonaRail) beside a content pane. The chat
// pane is BB's own ThreadChat component, so this plugin never reimplements a
// composer or a timeline.
import { useEffect, useState, type ReactNode } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { parseRoute } from "@/personas";
import { PersonaChatView } from "@/components/PersonaChatView";
import { PersonaEditor } from "@/components/PersonaEditor";
import { PersonaHome } from "@/components/PersonaHome";
import { PersonaRail } from "@/components/PersonaRail";
import { PluginHealthSection } from "@/components/PluginHealthSection";
import { PANEL_PATH } from "@/components/panel-path";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { usePersonasRpc } from "@/components/use-query";

/** A document-style pane (root empty state, transient create, the editor). */
function DocumentPane({
  onBack,
  children,
}: {
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack === undefined ? null : (
        <div className="flex shrink-0 items-center border-b border-border px-4 py-2">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex items-center justify-center hover:bg-accent`}
          >
            <Icon name="ChevronLeft" aria-hidden />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>
    </div>
  );
}

function PersonasPanel({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  const isCompact = useIsCompactViewport();
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  // "new" is a transient route, not a real screen: create a draft row
  // immediately and replace-navigate into its editor. PersonaEditor's `personaId`
  // prop is non-null, so nothing here ever mounts it without a real id.
  useEffect(() => {
    if (route.view !== "new" || isCreatingDraft) return;
    setIsCreatingDraft(true);
    rpc
      .call("createPersona", null)
      .then((created) => {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: `${created.personaId}/edit`,
          replace: true,
        });
      })
      .catch((cause) => {
        toast.error(cause instanceof Error ? cause.message : String(cause));
        navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
      })
      .finally(() => setIsCreatingDraft(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  const selectedPersonaId =
    route.view === "list" || route.view === "new" ? null : route.personaId;
  const goToRoot = () => navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  const onBack = isCompact ? goToRoot : undefined;

  let content: ReactNode;
  switch (route.view) {
    case "list":
      content = (
        <DocumentPane>
          <p className="p-6 text-center text-sm text-muted-foreground">
            Pick a persona to get started.
          </p>
        </DocumentPane>
      );
      break;
    case "new":
      content = (
        <DocumentPane>
          <p className="p-6 text-center text-sm text-muted-foreground">
            Setting up your persona…
          </p>
        </DocumentPane>
      );
      break;
    case "persona":
    case "edit":
      // The persona detail page IS the live edit: clicking a persona in the
      // rail lands straight in its editor (every field autosaves), so there
      // is no separate settings/config screen to gear into.
      content = (
        <DocumentPane onBack={onBack}>
          <PersonaEditor personaId={route.personaId} />
        </DocumentPane>
      );
      break;
    case "newChat":
      content = <PersonaHome personaId={route.personaId} onBack={onBack} />;
      break;
    case "chat":
      content = (
        <PersonaChatView
          personaId={route.personaId}
          threadId={route.threadId}
          onBack={onBack}
        />
      );
      break;
  }

  // One pane at a time on a compact viewport: the rail alone at the root,
  // the content pane alone (with its own back affordance) once a persona is
  // selected. Both panes own their own scrolling, so neither can produce a
  // double scrollbar.
  if (isCompact) {
    return (
      <div className="h-full min-h-0">
        {selectedPersonaId === null && route.view !== "new" ? (
          <PersonaRail selectedPersonaId={null} />
        ) : (
          content
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <PersonaRail selectedPersonaId={selectedPersonaId} />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "personas",
    title: "Personas",
    icon: "personas/speaking",
    path: PANEL_PATH,
    component: PersonasPanel,
  });

  // The Personas settings page: an install-source row (local in-progress
  // checkout vs managed/official install) plus a Plugin health box listing
  // the other plugins this one cooperates with (Floating Notes), with a
  // green check when it is installed and enabled and an install link to its
  // bb plugin page while it is missing.
  app.slots.settingsSection({
    id: "plugin-health",
    title: "Plugin health",
    description: "Other plugins Personas can work with.",
    component: PluginHealthSection,
  });
});
