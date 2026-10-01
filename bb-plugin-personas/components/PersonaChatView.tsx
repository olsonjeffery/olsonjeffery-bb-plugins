import { ThreadChat, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaHeader } from "@/components/PersonaHome";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";

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

  // Deleting a persona leaves its chats intact (they just stop receiving the
  // persona), so this stays reachable from an already-open chat.
  async function remove() {
    if (persona === null) return;
    try {
      await rpc.call("deletePersona", { personaId });
      toast.success(`Deleted ${persona.name}`);
      navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

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
          onNewChat={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: `${personaId}/new` })
          }
          onDeletePersona={() => void remove()}
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
