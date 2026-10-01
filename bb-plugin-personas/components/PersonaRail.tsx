import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import { cn } from "@/lib/utils";
import {
  displayName,
  joinedPromptText,
  previewInstructions,
} from "@/personas";

const WIDTH_KEY = "personas:rail:width";
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 260;

/**
 * localStorage itself — not just its contents — can't be trusted: some test
 * and embedded-webview environments provide a `window.localStorage` whose
 * methods throw or are missing entirely. Every read/write goes through these
 * so a storage failure degrades to "nothing persisted", never a crash.
 */
function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is a nice-to-have; losing it silently beats crashing.
  }
}

function readStoredWidth(): number {
  const raw = safeGetItem(WIDTH_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
}

/**
 * Short relative timestamp for rail rows and the persona page's chat list:
 * "now", "2m", "3h", "5d", then a date.
 */
export function formatRelative(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < minute) return "now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < week) return `${Math.floor(diffMs / day)}d`;
  return new Date(timestamp).toLocaleDateString();
}

export function PersonaRail({ selectedPersonaId }: { selectedPersonaId: string | null }) {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();
  const { data, error } = useQuery(() => rpc.call("listRail", null), "rail");
  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const [isCreating, setIsCreating] = useState(false);

  // Kept for the resize handle only; nothing here reads the node itself.
  const dragOrigin = useRef<{ startX: number; startWidth: number } | null>(null);

  async function createPersona() {
    setIsCreating(true);
    try {
      const created = await rpc.call("createPersona", null);
      navigate.toPluginPanel(PANEL_PATH, { subPath: `${created.personaId}/edit` });
    } finally {
      setIsCreating(false);
    }
  }

  // Drag-resize on the trailing edge — plain pointer events, no library.
  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragOrigin.current = { startX: event.clientX, startWidth: width };

    function onMove(moveEvent: PointerEvent) {
      const origin = dragOrigin.current;
      if (origin === null) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, origin.startWidth + moveEvent.clientX - origin.startX),
      );
      setWidth(next);
    }
    function onUp(upEvent: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const origin = dragOrigin.current;
      dragOrigin.current = null;
      if (origin === null) return;
      const finalWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, origin.startWidth + upEvent.clientX - origin.startX),
      );
      safeSetItem(WIDTH_KEY, String(finalWidth));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const personas = data?.personas ?? [];

  return (
    <div
      style={{ width }}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-border"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">Personas</h2>
        <button
          type="button"
          aria-label={isCreating ? "Creating…" : "New persona"}
          disabled={isCreating}
          onClick={() => void createPersona()}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex items-center justify-center hover:bg-accent disabled:opacity-50`}
        >
          <Icon name="Plus" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : personas.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No personas yet.</p>
            <Button
              size="sm"
              className="mt-2"
              disabled={isCreating}
              onClick={() => void createPersona()}
            >
              New persona
            </Button>
          </div>
        ) : (
          <ul>
            {personas.map((persona) => {
              const isSelected = persona.id === selectedPersonaId;
              const isDraft = persona.status === "draft";
              const newestChat = persona.chats[0];
              const secondary =
                newestChat === undefined
                  ? previewInstructions(joinedPromptText(persona.prompts))
                  : newestChat.title ?? "New chat";

              return (
                <li key={persona.id}>
                  <div
                    className={cn(
                      "flex items-stretch",
                      isSelected
                        ? "border-l-2 border-l-primary bg-accent"
                        : isDraft
                          ? "border-l-2 border-dashed border-l-border"
                          : "border-l-2 border-l-transparent",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        navigate.toPluginPanel(PANEL_PATH, { subPath: persona.id })
                      }
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-accent",
                        isDraft ? "text-muted-foreground" : "",
                      )}
                    >
                      <PersonaAvatar personaId={persona.id} emoji={persona.emoji} color={persona.color} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {displayName(persona)}
                          </span>
                          {isDraft ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 px-1 py-0 text-[10px]"
                            >
                              DRAFT
                            </Badge>
                          ) : null}
                          <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground">
                            {formatRelative(persona.lastActivityAt)}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {secondary}
                        </span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none"
      />
    </div>
  );
}
