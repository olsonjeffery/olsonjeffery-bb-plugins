import { useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { ChatRow } from "@/components/ChatRow";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import { cn } from "@/lib/utils";
import { displayName, draftBlockers, joinedPromptText, type Persona } from "@/personas";

/**
 * The content-pane header shared by PersonaHome and PersonaChatView. There's no
 * dropdown primitive vendored under components/ui and this plugin adds no
 * new dependencies, so the more-actions menu is a plain absolutely-positioned
 * panel of buttons rather than a radix dropdown.
 */
export function PersonaHeader({
  persona,
  onBack,
  onNewChat,
  onDeletePersona,
  onGoToPersonaPage,
}: {
  persona: Persona;
  onBack?: () => void;
  onNewChat: () => void;
  onDeletePersona: () => void;
  /** Omit when already on the persona's own page — the name renders as plain text. */
  onGoToPersonaPage?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The menu used to close on the trigger's own onBlur, which fires on
  // mousedown — before a menu item's click ever lands, so every item was
  // dead. Closing on the *container's* blur instead, and only when focus
  // actually left the container, lets focus move from the trigger to an
  // item without closing the menu out from under the click.
  function onMenuContainerBlur(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next !== null && event.currentTarget.contains(next)) return;
    setMenuOpen(false);
  }

  function onMenuContainerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

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
      <div
        className="relative shrink-0"
        onBlur={onMenuContainerBlur}
        onKeyDown={onMenuContainerKeyDown}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex items-center justify-center hover:bg-accent`}
        >
          <Icon name="MoreHorizontal" aria-hidden />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-10 mt-1 w-36 rounded-md border border-border bg-popover p-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onNewChat();
              }}
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              New chat
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDeleteDialogOpen(true);
              }}
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
            >
              Delete persona
            </button>
          </div>
        ) : null}
      </div>

      {/* Deleting is irreversible, so it always goes through this confirmation
          rather than firing straight off the menu click. */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {displayName(persona)}?</DialogTitle>
            <DialogDescription>
              Its chats stay in BB but stop following these instructions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteDialogOpen(false);
                onDeletePersona();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  // TS's control-flow narrowing of `persona` doesn't reach into the closures
  // below, so the name is captured here rather than re-read from `persona`.
  const personaName = displayName(persona);

  // The composer only clears its draft when onSubmit resolves and keeps it
  // if onSubmit throws, so a failed create never loses the user's message
  // or uploaded images — toast and rethrow rather than swallow the error.
  async function startChat(request: NewThreadRequest) {
    try {
      const started = await rpc.call("startChat", { personaId, request });
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: `${personaId}/${started.threadId}`,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  async function remove() {
    try {
      await rpc.call("deletePersona", { personaId });
      toast.success(`Deleted ${personaName}`);
      navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const isDraft = persona.status === "draft";
  const blockers = draftBlockers(persona);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PersonaHeader
        persona={persona}
        onBack={onBack}
        onNewChat={() =>
          navigate.toPluginPanel(PANEL_PATH, { subPath: `${personaId}/new` })
        }
        onDeletePersona={() => void remove()}
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
              <NewThreadComposer
                defaultProjectId={persona.projectId ?? personalProjectId ?? undefined}
                defaultProviderId={persona.providerId}
                defaultModel={persona.model}
                {...(persona.reasoningLevel === null
                  ? {}
                  : { defaultReasoningLevel: persona.reasoningLevel })}
                placeholder={`Message ${displayName(persona)}…`}
                layout="document"
                draftKey={`personas:start:${personaId}`}
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
                          onOpen={() =>
                            navigate.toPluginPanel(PANEL_PATH, {
                              subPath: `${personaId}/${chat.threadId}`,
                            })
                          }
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
                            onOpen={() =>
                              navigate.toPluginPanel(PANEL_PATH, {
                                subPath: `${personaId}/${chat.threadId}`,
                              })
                            }
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
