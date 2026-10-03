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
import {
  composerShare,
  resolveComposerOpen,
  useComposerCarryShare,
} from "@/components/composer-share";
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
  // The data belongs to this page only when it really is this persona's row:
  // a navigation between personas renders the previous row until the new one
  // lands, and that frame must not seed anything — injecting the previous
  // persona's message into the composer for a beat is exactly the
  // foreign-text flash between two personas.
  const persona = data?.[0]?.persona ?? null;
  const ownRow = persona !== null && persona.id === personaId;
  const defaultUserMessage = clampDefaultUserMessage(
    ownRow ? persona.defaultUserMessage ?? "" : "",
  );

  // The one-shot homepage handoff, read reactively: choosing a persona from
  // the homepage launcher stored the homepage draft here, and a persona page
  // for the same persona gets it at first render. Clicking around within the
  // persona screen never sets one, so the read is null and the composer opens
  // empty (or with the Default User Message).
  const carry = useComposerCarryShare(personaId);

  // The handoff is one-shot, but the seed must be PERMANENT for this open: bb
  // applies initialPrompt through an async pipeline, so the seed text has to
  // stay stable — consuming the store on announce would flip the prop before
  // bb has seeded anything and the homepage draft would silently vanish. So
  // the consumed value is CLAIMED into component state (a copy with the same
  // value) and every later render of this open reuses the claim verbatim.
  const [carryClaim, setCarryClaim] = useState<{
    personaId: string;
    msg: string;
    text: string | null;
  } | null>(null);
  const claimActive =
    carryClaim !== null &&
    carryClaim.personaId === personaId &&
    carryClaim.msg === defaultUserMessage;
  const consumedCarry = claimActive ? carryClaim.text : carry;

  // What this open seeds: the carried homepage draft when there is one, else
  // the Default User Message (which can be "" — an empty seed). Gated on the
  // row matching the route; a stale transit frame seeds nothing at all.
  const { seedText } = resolveComposerOpen({
    carry: ownRow ? consumedCarry : null,
    msg: defaultUserMessage,
  });

  // Every open claims a FRESH draft slot: selecting a persona produces an
  // empty-or-Default composer at all times — no slot draft from an earlier
  // visit can reappear. The claim is derived from the (persona, message)
  // pair during render, so an identity-only reload of the same pair keeps
  // the composer and its text untouched.
  const visitRef = useRef<{
    personaId: string;
    msg: string;
    draftKey: string;
  } | null>(null);
  if (
    ownRow &&
    (visitRef.current === null ||
      visitRef.current.personaId !== personaId ||
      visitRef.current.msg !== defaultUserMessage)
  ) {
    visitRef.current = {
      personaId,
      msg: defaultUserMessage,
      draftKey: `personas:start:${personaId}#${composerShare.claimVisit()}`,
    };
  }
  // Hold the last claimed slot through a navigation's transit frames:
  // dropping to an undefined key would briefly bind the composer to the
  // plugin's default draft slot, which nothing ever reads again once
  // contaminated. The claimed key rebinds as soon as the new row lands.
  const visit = visitRef.current;

  // Announce the open so the in-composer banner parses this open exactly
  // once: it flashes the prompt box when a carried homepage draft won and
  // the Default User Message differed. Gated on the load and the persona
  // row matching, so the loading render and a stale row don't announce.
  // The handoff's consumed value is claimed here — one announcement outlives
  // the store clear it causes, exactly as the claimActive doc explains.
  useEffect(() => {
    if (!ownRow) return;
    const consumed = composerShare.takeCarry(personaId);
    setCarryClaim({ personaId, msg: defaultUserMessage, text: consumed });
    const { flash } = resolveComposerOpen({
      carry: consumed,
      msg: defaultUserMessage,
    });
    composerShare.announce(flash);
    return () => composerShare.close();
  }, [personaId, defaultUserMessage, ownRow]);

  if (error !== null) {
    return <p className="p-4 text-sm text-destructive">{error}</p>;
  }
  if (data === null) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

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
            <            >
              <NewThreadComposer
                defaultProjectId={persona.projectId ?? personalProjectId ?? undefined}
                defaultProviderId={persona.providerId}
                defaultModel={persona.model}
                {...(persona.reasoningLevel === null
                  ? {}
                  : { defaultReasoningLevel: persona.reasoningLevel })}
                placeholder={`Message ${displayName(persona)}…`}
                layout="document"
                draftKey={visit?.draftKey}
                {...(seedText === "" ? {} : { initialPrompt: seedText })}
                onSubmit={startChat}
              />

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
