// The Thread Info chip: a small always-visible control in the thread header's
// action row showing which persona is active for this session (the thread's
// mapped chat), collapsing to the avatar alone on compact viewports. Clicking
// it opens that persona's settings page. Threads without a persona render
// nothing, so the row stays as short as the host's own actions.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";

export function PersonaThreadChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  // One query per thread; useQuery reloads on the plugin's realtime signal,
  // so renames and color changes land without a remount.
  const { data, error } = useQuery(
    () => rpc.call("getPersonaForThread", { threadId }),
    `thread:${threadId}`,
  );

  if (error !== null) return null;
  const persona = data?.persona ?? null;
  if (persona === null) return null;
  // The wire lookup carries a summary shape (id/name/emoji/color) only.
  const name = persona.name.trim() || "Untitled persona";

  return (
    <button
      type="button"
      aria-label={`Chatting as ${name} — open persona settings`}
      title={`Chatting as ${name} — open persona settings`}
      onClick={() =>
        navigate.toPluginPanel(PANEL_PATH, { subPath: `${persona.id}/edit` })
      }
      className="inline-flex h-8 items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <PersonaAvatar
        personaId={persona.id}
        emoji={persona.emoji}
        color={persona.color}
        size="sm"
        className="size-5 rounded-sm text-xs"
      />
      {isCompactViewport ? null : (
        <span className="max-w-40 truncate">{name}</span>
      )}
    </button>
  );
}
