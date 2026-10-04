import {
  useBbNavigate,
  useComposer,
  type ComposerSelection,
} from "@get-bb/plugin-sdk/app";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { composerShare } from "@/components/composer-share";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import { displayName, previewInstructions, joinedPromptText } from "@/personas";

/**
 * The Personas section on BB's generic New Thread screen (homepage): a
 * compact launcher listing the published personas. Choosing one moves to
 * that persona's composer view inside the Personas panel — the same page
 * the personas list lands on — rather than starting an unpersonad thread.
 * The click is also the one-shot homepage handoff: the homepage composer's
 * draft text and its picked project/environment as they read right there
 * travel with the selection; the persona page seeds them over its own
 * defaults.
 */
export function PersonaHomepageSection() {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  const composer = useComposer();
  const { data, error } = useQuery(() => rpc.call("listRail", null), "rail");

  // The click moment is the whole handoff. The composer's picker values are
  // reachable only through its own settle-resolution (no synchronous read
  // exists for environment), so the click resolves that FIRST — typical case
  // is instantaneous, since the composer is right there and settled — then
  // stores everything at once and navigates. A composer that can't answer
  // (still settling, no pickers) carries the draft and project only.
  const choose = async (personaId: string) => {
    let selection: ComposerSelection | null = null;
    try {
      selection = await composer.setSelection({});
    } catch {
      selection = null;
    }
    composerShare.setHomepageCarry(personaId, {
      text: composer.text,
      projectId: selection?.projectId ?? (composer.scope.kind === "new-thread" ? composer.scope.projectId : null),
      environment: selection?.environment,
    });
    navigate.toPluginPanel(PANEL_PATH, { subPath: personaId });
  };

  const personas = (data?.personas ?? []).filter(
    (persona) => persona.status === "published",
  );

  return (
    <div className="space-y-2">
      {error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : personas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No personas yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {personas.map((persona) => (
            <li key={persona.id}>
              <button
                type="button"
                onClick={() => {
                  void choose(persona.id);
                }}
                className="flex w-full min-w-0 items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <PersonaAvatar
                  personaId={persona.id}
                  emoji={persona.emoji}
                  color={persona.color}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {displayName(persona)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {previewInstructions(joinedPromptText(persona.prompts))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
