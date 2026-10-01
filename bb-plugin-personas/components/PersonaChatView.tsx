import { ThreadChat, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaHeader } from "@/components/PersonaHome";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";

/**
 * The embedded chat view, reachable only on a deep link to
 * `<personaId>/<threadId>` — normal flow opens chats on BB's real thread
 * route (navigate.toThread). No delete affordance here: deleting a persona
 * lives in its settings screen.
 */
export function PersonaChatView({
  personaId,
  threadId,
  onBack,
}: {
  personaId: string;
  threadId: string;
  onBack?: () => void;
}) {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  const { data, error } = useQuery(() => rpc.call("getPersona", { personaId }), `chat:${personaId}`);
  const persona = data?.persona ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {persona === null ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          {onBack === undefined ? null : (
            <button
              type="button"
              aria-label="Back"
              onClick={onBack}
              className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex items-center justify-center hover:bg-accent`}
            >
              <Icon name="ChevronLeft" aria-hidden />
            </button>
          )}
          {error !== null ? (
            <span className="truncate text-sm text-destructive">{error}</span>
          ) : (
            <span className="truncate text-sm font-medium">Persona</span>
          )}
        </div>
      ) : (
        <PersonaHeader
          persona={persona}
          onBack={onBack}
          onGoToPersonaPage={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: personaId })
          }
        />
      )}
      <div className="min-h-0 flex-1">
        <ThreadChat threadId={threadId} variant="full" layout="contained" />
      </div>
    </div>
  );
}
