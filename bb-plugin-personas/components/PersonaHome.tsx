import { useEffect, useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { ChatRow } from "@/components/ChatRow";
import { flashDefaultMessageIfRejected } from "@/components/default-user-message";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import { cn } from "@/lib/utils";
import {
  clampDefaultUserMessage,
  displayName,
  draftBlockers,
  joinedPromptText,
  type Persona,
} from "@/personas";

/**
 * The content-pane header shared by PersonaHome and PersonaChatView: back
 * affordance, persona identity, and the gear into the settings screen.
 * Deleting lives in the settings screen, not here.
 */
export function PersonaHeader({
  persona,
  onBack,
  onGoToPersonaPage,
  onOpenSettings,
}: {
  persona: Persona;
  onBack?: () => void;
  /** Omit when already on the persona's own page — the name renders as plain text. */
  onGoToPersonaPage?: () => void;
  /** Omit on chat views — settings live on the persona's composer page. */
  onOpenSettings?: () => void;
}) {
  const subtitle = [persona.providerId, persona.model, persona.reasoningLevel]
    .filter((part) => part !== null && part !== "")
    .join(" · ");

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex shrink-0 items-center justify-center hover:bg-accent`}
        >
          <Icon name="ChevronLeft" aria-hidden />
        </button>
      )}
      <PersonaAvatar personaId={persona.id} emoji={persona.emoji} color={persona.color} size="sm" />
      <div className="min-w-0 flex-1">
        {onGoToPersonaPage === undefined ? (
          <p className="truncate text-sm font-medium">{displayName(persona)}</p>
        ) : (
          <button
            type="button"
            onClick={onGoToPersonaPage}
            className="truncate text-left text-sm font-medium hover:underline"
          >
            {displayName(persona)}
          </button>
        )}
        {subtitle === "" ? null : (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {onOpenSettings === undefined ? null : (
        <button
          type="button"
          aria-label="Edit persona settings"
          onClick={onOpenSettings}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex shrink-0 items-center justify-center hover:bg-accent`}
        >
          <Icon name="Settings" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function PersonaHome({
  personaId,
  onBack,
}: {
  personaId: string;
  onBack?: () => void;
}) {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);

  // One round trip: the persona, the picker options the composer needs, and its
  // chat list, so this pane never waterfalls into a second call after load.
  const { data, error, reload } = useQuery(
    () =>
      Promise.all([
        rpc.call("getPersona", { personaId }),
        rpc.call("listOptions", null),
        rpc.call("listChats", { personaId }),
      ]),
    `home:${personaId}`,
  );

  // The Default User Message this composer page injects: trimmed, "" when
  // none provided (whitespace-only counts as none — nothing is injected).
  // Read defensively because this runs during the loading render too.
  const defaultUserMessage = clampDefaultUserMessage(
    data?.[0]?.persona?.defaultUserMessage ?? "",
  );

  // The composer opens with the persona's Default User Message in its text
  // area — via the host's initialPrompt seed, which applies only while the
  // draft is still empty. When the composer opened holding work-in-progress
  // text instead, the seed was refused, so flash the prompt box border red
  // once to say the message was not applied. The probe runs right after the
  // composer's first commit, before its async seed lands, so the text it
  // reads is exactly the draft the composer opened with.
  useEffect(() => {
    if (defaultUserMessage === "") return;
    const root = composerWrapRef.current;
    if (root === null) return;
    return flashDefaultMessageIfRejected(root, defaultUserMessage);
  }, [defaultUserMessage]);

  if (error !== null) {
    return <p className="p-4 text-sm text-destructive">{error}</p>;
  }
  if (data === null) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  const persona = data[0].persona;
  if (persona === null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        This persona was deleted.
      </p>
    );
  }
  const { personalProjectId } = data[1];
  const chats = data[2].chats;
  const archivedChats = data[2].archivedChats;

  // The composer only clears its draft when onSubmit resolves and keeps it
  // if onSubmit throws, so a failed create never loses the user's message
  // or uploaded images — toast and rethrow rather than swallow the error.
  async function startChat(request: NewThreadRequest) {
    try {
      const started = await rpc.call("startChat", { personaId, request });
      // Open on BB's real thread route: the host's right side panel (side
      // chats, terminal, other plugins' actions) only attaches to the main
      // thread view, and a ThreadChat embedded in this panel never gets it.
      navigate.toThread(started.threadId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  const isDraft = persona.status === "draft";
  const blockers = draftBlockers(persona);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PersonaHeader
        persona={persona}
        onBack={onBack}
        onOpenSettings={() =>
          navigate.toPluginPanel(PANEL_PATH, { subPath: `${personaId}/edit` })
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {persona.prompts.length === 0 ? null : (
            <div className="rounded-lg border border-border bg-card p-3">
              {/* No `block` here: it also sets `display` and, sitting later in
                  the generated CSS at equal specificity, silently beats
                  line-clamp's -webkit-box — that's what let the old PersonaDetail
                  page render the whole instruction text uncollapsed. */}
              <span
                className={cn(
                  "whitespace-pre-wrap break-words text-sm text-muted-foreground",
                  instructionsExpanded ? "" : "line-clamp-3",
                )}
              >
                {joinedPromptText(persona.prompts)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setInstructionsExpanded((expanded) => !expanded)
                }
                className="mt-1 flex items-center gap-1 text-xs font-medium text-foreground/70 hover:text-foreground"
              >
                {instructionsExpanded ? "Show less" : "Show more"}
                <Icon
                  name={instructionsExpanded ? "ChevronUp" : "ChevronDown"}
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            </div>
          )}

          {isDraft ? (
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="text-sm font-medium">
                Finish setting up this persona
              </p>
              {blockers.length > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Missing: {blockers.join(", ")}
                </p>
              ) : null}
              <Button
                size="sm"
                className="mt-3"
                onClick={() =>
                  navigate.toPluginPanel(PANEL_PATH, {
                    subPath: `${personaId}/edit`,
                  })
                }
              >
                Set up →
              </Button>
            </div>
          ) : (
            <>
              <div ref={composerWrapRef}>
                <NewThreadComposer
                  defaultProjectId={persona.projectId ?? personalProjectId ?? undefined}
                  defaultProviderId={persona.providerId}
                  defaultModel={persona.model}
                  {...(persona.reasoningLevel === null
                    ? {}
                    : { defaultReasoningLevel: persona.reasoningLevel })}
                  {...(defaultUserMessage === ""
                    ? {}
                    : { initialPrompt: defaultUserMessage })}
                  placeholder={`Message ${displayName(persona)}…`}
                  layout="document"
                  draftKey={`personas:start:${personaId}`}
                  onSubmit={startChat}
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  Chats ({chats.length})
                </h3>
                {chats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No chats yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {chats.map((chat) => (
                      <li key={chat.threadId}>
                        <ChatRow
                          chat={chat}
                          archived={false}
                          onOpen={() => navigate.toThread(chat.threadId)}
                          reload={reload}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {archivedChats.length === 0 ? null : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setArchivedExpanded((expanded) => !expanded)
                    }
                    aria-expanded={archivedExpanded}
                    className="flex items-center gap-1 text-sm font-medium text-foreground/70 hover:text-foreground"
                  >
                    <Icon
                      name={archivedExpanded ? "ChevronDown" : "ChevronRight"}
                      className="size-3.5"
                      aria-hidden
                    />
                    Archived ({archivedChats.length})
                  </button>
                  {archivedExpanded ? (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {archivedChats.map((chat) => (
                        <li key={chat.threadId}>
                          <ChatRow
                            chat={chat}
                            archived
                            onOpen={() => navigate.toThread(chat.threadId)}
                            reload={reload}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
