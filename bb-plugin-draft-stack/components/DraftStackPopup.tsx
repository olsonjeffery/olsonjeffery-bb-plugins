// The Draft Stack Select (DSS) popup: a select list raised above the prompt
// window by the composer's stack inline action or the palette command. Rows
// render the stack in array order — the bottom first, the TOP as the last
// row — and the keyboard highlight STARTS at that bottom of the list, on the
// top of the stack, so Enter immediately pops the newest draft. Mouse hover
// moves the highlight; the highlighted row wears a halo in bb's icon color.
//
// Picking a row pops it: the entry is removed from the stack and installed
// into the composer verbatim (text, mention pills, attachments). The popup
// also exposes the two palette actions that need a composer (Push) plus a
// jump to the stack's settings page.
import { useEffect, useRef, useState } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { installEntry, pushCurrentDraft } from "@/components/draft-stack-actions";
import { useDraftStack, useIconAccent } from "@/components/use-draft-stack";
import { relativeSavedAt } from "@/draft-stack";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const POPUP_ID = "selector";

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function DraftStackPopup() {
  const composer = useComposer();
  const { rpc, stack, error, reload } = useDraftStack();
  const accent = useIconAccent();
  const entries = stack ?? [];
  // Browser-history navigation: the highlight starts on the BOTTOM row of
  // the list, which is the top of the stack.
  const [highlight, setHighlight] = useState<number>(-1);
  const [isBusy, setIsBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const now = Date.now();

  useEffect(() => {
    setHighlight(entries.length - 1);
    // Re-anchor only when the stack identity changes; rows keep their row
    // while the list is otherwise untouched.
  }, [stack]);

  useEffect(() => {
    if (highlight < 0 || listRef.current === null) return;
    const row = listRef.current.children[highlight];
    if (typeof row?.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (entries.length === 0) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, entries.length - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (highlight >= 0 && highlight < entries.length) {
        void pick(entries[highlight]!.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      composer.experimental_closePopup();
    }
  }

  async function pick(entryId: string) {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await installEntry(composer, rpc, entryId);
      composer.experimental_closePopup();
    } catch (cause) {
      toast.error(describeError(cause));
      reload();
    } finally {
      setIsBusy(false);
    }
  }

  async function push() {
    if (isBusy || composer.isEmpty) return;
    setIsBusy(true);
    try {
      await pushCurrentDraft(composer, rpc);
      toast.success("Pushed to Draft Stack");
      reload();
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsBusy(false);
    }
  }

  function gotoSettings() {
    composer.experimental_closePopup();
    // bb has no SDK navigation into Settings; a same-origin assign lands the
    // app on the plugin's settings detail page.
    window.location.assign("/settings/plugins/draft-stack");
  }

  return (
    <div
      role="listbox"
      aria-label="Draft Stack"
      tabIndex={0}
      onKeyDown={onKeyDown}
      autoFocus
      style={{
        // The selection halo wears the user's globally chosen bb-icon color.
        "--dss-halo": accent,
      } as React.CSSProperties}
      className="flex max-h-[min(60vh,26rem)] w-[24rem] max-w-[80vw] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none focus-visible:ring-1 focus-visible:ring-border"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Draft Stack
          {entries.length > 0 ? ` · ${entries.length}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={composer.isEmpty || isBusy}
            onClick={() => void push()}
            title="Push the current draft onto the stack"
            aria-label="Push current draft onto the stack"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Icon name="ArrowUp" className="size-3.5" aria-hidden />
            Push draft
          </button>
          <button
            type="button"
            onClick={gotoSettings}
            title="Go to Draft Stack settings"
            aria-label="Go to Draft Stack settings"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="Settings" className="size-3.5" aria-hidden />
            Settings
          </button>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {stack === null ? (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">Loading the stack…</p>
        ) : entries.length === 0 ? (
          <div className="m-2 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            The stack is empty. Push the current draft with “Push draft”.
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.id}
              role="option"
              aria-selected={index === highlight}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => void pick(entry.id)}
              style={
                index === highlight
                  ? {
                      // Halo: the selected row glows in the bb-icon color.
                      boxShadow:
                        `0 0 0 1px color-mix(in srgb, var(--dss-halo) 75%, transparent),` +
                        ` 0 0 0 4px color-mix(in srgb, var(--dss-halo) 22%, transparent)`,
                    }
                  : undefined
              }
              className={cn(
                "mx-1.5 cursor-pointer rounded-md border border-transparent px-2.5 py-2 transition-[box-shadow,background-color]",
                index === highlight ? "bg-accent/40" : "hover:bg-accent/30",
              )}
            >
              <p
                className={cn(
                  "line-clamp-2 text-sm whitespace-pre-wrap break-words",
                  entry.text === "" && "text-muted-foreground italic",
                )}
              >
                {entry.text === "" ? "(no text — attachments only)" : entry.text}
              </p>
              <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  {index === entries.length - 1 ? (
                    <>
                      <Icon name="ChevronsUp" className="size-3" aria-hidden />
                      top
                    </>
                  ) : (
                    <span>#{index + 1}</span>
                  )}
                </span>
                <span>{relativeSavedAt(entry.createdAt, now)}</span>
                {entry.mentions.length > 0 ? (
                  <span>@{entry.mentions.length}</span>
                ) : null}
                {entry.attachments.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="Paperclip" className="size-3" aria-hidden />
                    {entry.attachments.length}
                  </span>
                ) : null}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        Picking a row pops it into the composer. <Icon name="CornerDownLeft" className="inline size-3" aria-hidden /> pick · <Icon name="ChevronUp" className="inline size-3" aria-hidden />/<Icon name="ChevronDown" className="inline size-3" aria-hidden /> move
      </div>
    </div>
  );
}
