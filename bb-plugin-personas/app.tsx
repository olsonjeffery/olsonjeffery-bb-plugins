// bb-plugin-personas — frontend entry.
//
// A persistent left rail of personas (PersonaRail) beside a settings pane.
// Selecting a persona opens its settings directly; all new-thread starts with
// a persona go through the persona inline action on BB's New Thread composer.
import { useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_THREAD_ACTION_GROUPS,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import "./app.css";
import { parseRoute } from "@/personas";
import { PersonaChatView } from "@/components/PersonaChatView";
import { DataSection } from "@/components/DataSection";
import { PersonaEditor } from "@/components/PersonaEditor";
import {
  PersonaInlineAction,
  PersonaPickerPopup,
  PersonaRobotGlyph,
  PERSONA_PICKER_POPUP_ID,
} from "@/components/PersonaComposerPicker";
import { PersonaRail } from "@/components/PersonaRail";
import { PluginHealthSection } from "@/components/PluginHealthSection";
import { PANEL_PATH } from "@/components/panel-path";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { usePersonasRpc, useQuery } from "@/components/use-query";

/** The persona summary `getPersonaForThread` returns for one thread. */
interface PersonaSummary {
  id: string;
  name: string;
  emoji: string;
}

/**
 * `useData` for the header's persona action: one summary per on-screen
 * thread id, fetched through the plugin's realtime-backed `useQuery` so
 * renames and emoji changes land without a remount. A header action only
 * ever sees the open thread's id, so this stays one small query.
 */
function usePersonaSummaries(
  threadIds: readonly string[],
): Record<string, PersonaSummary | null> {
  const rpc = usePersonasRpc();
  const key = threadIds.join("\n");
  const { data } = useQuery(
    async () => {
      const entries = await Promise.all(
        threadIds.map(async (threadId) => {
          const { persona } = await rpc.call("getPersonaForThread", {
            threadId,
          });
          return [threadId, persona] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    key,
  );
  return data ?? {};
}

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
            Pick a persona to edit, or start a chat with one from BB's New
            Thread screen via the persona button.
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
    case "newChat":
    case "edit":
      // Every persona route lands in settings now: the rail's click, old
      // composer-page links (<personaId>, <personaId>/new), and direct
      // settings links (<personaId>/edit) all show the editor.
      //
      // The record IS the identity: a key on personaId remounts the editor
      // when the rail selection moves between two personas, so its seeded
      // form state (name, emoji, providers, Default User Message) can never
      // outlive the persona it was seeded from. Without the key, the same
      // mounted editor would keep one persona's form while the data-driven
      // panes (prompt pool, chats) reload the next persona's rows — the
      // mismatch the rail navigation used to leave on screen.
      content = (
        <DocumentPane onBack={onBack}>
          <PersonaEditor key={route.personaId} personaId={route.personaId} />
        </DocumentPane>
      );
      break;
    case "chat":
      // Deep-link surface only: opening a chat from the plugin now goes to
      // BB's real thread route (navigate.toThread), where the host's right
      // side panel connects. Anything landing at <personaId>/<threadId>
      // (old bookmarks, history entries) still renders the embedded view —
      // keyed by both segments for the same reason as the editor.
      content = (
        <PersonaChatView
          key={`${route.personaId}:${route.threadId}`}
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
    icon: "personas/robot",
    path: PANEL_PATH,
    component: PersonasPanel,
  });

  // The robot glyph as an app-wide icon name: the inline action and any other
  // surface that draws `personas/robot` renders this component. It is the
  // same drawing the branding asset carries, recolored to currentColor.
  app.experimental_icons.register({
    name: "personas/robot",
    component: PersonaRobotGlyph,
  });

  // The persona inline action on the New Thread composer: the robot button
  // opens the persona picker popup; choosing a persona inserts THE persona
  // mention pill into the draft (one at a time, removable), and the send
  // carries the persona to the server's dispatch hook.
  app.composer.customize({
    id: "persona-inline-action",
    scopes: ["new-thread"],
    actions: [{ id: "persona", component: PersonaInlineAction }],
    experimental_popups: [
      {
        id: PERSONA_PICKER_POPUP_ID,
        label: "Select persona for this session",
        component: PersonaPickerPopup,
      },
    ],
  });

  // The header's persona action: bb's header thread action — the retired
  // experimental_threadHeaderAction slot's replacement. A button in the open
  // thread's header showing which persona this session chats as (emoji and
  // name for a mapped thread, nothing otherwise); on compact viewports the
  // host folds it into the header's thread menu. Clicking opens the
  // persona's settings page.
  app.slots.experimental_threadAction({
    id: "persona-chip",
    title: "Persona",
    icon: "personas/robot",
    group: experimental_THREAD_ACTION_GROUPS.settings,
    placement: "header",
    useData: ({ threadIds }) => usePersonaSummaries(threadIds),
    item: ({ thread, data, navigate }) => {
      const persona = data[thread.id];
      if (persona === undefined || persona === null) return null;
      const name = persona.name.trim() || "Untitled persona";
      return {
        label: persona.emoji ? `${persona.emoji} ${name}` : name,
        icon: "personas/robot",
        run: () => {
          navigate.toPluginPanel(PANEL_PATH, {
            subPath: `${persona.id}/edit`,
          });
        },
      };
    },
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

  // The Export & import card: one personas.json file, one object per persona,
  // prompts verbatim (live prompts carry their source's content at export
  // time), emoji and color included; import is additive and renames on
  // collision as "Name (NEW-IMPORT)".
  app.slots.settingsSection({
    id: "personas-data",
    title: "Export & import",
    description: "Move your personas between BB instances.",
    component: DataSection,
  });
});
