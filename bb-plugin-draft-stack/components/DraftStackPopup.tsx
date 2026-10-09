// The Draft Stack Select (DSS) popup: a select list raised above the prompt
// window by the composer's stack inline action or the palette command. Rows
// render the stack in array order — the bottom first, the TOP as the last
// row — and the keyboard highlight STARTS at that bottom of the list, on the
// top of the stack, so Enter immediately pops the newest draft. Mouse hover
// moves the highlight; the highlighted row wears a halo in bb's icon color.
//
// Picking a row pops it: the entry is removed from the stack and installed
// into the composer verbatim (text, mention pills, attachments).
//
// The DSS attaches to the message box: the popup prefers the space ABOVE the
// composer — falling to below only when the top side cannot fit it — and the
// edge shared with the composer is squared and border-less, styled as a
// single line with the composer's own border. The host owns the popup
// container (the composer's shared mention-menu wrapper, marked
// `[data-promptbox-typeahead-menu]` inside `[data-promptbox]`), so this
// component measures the composer and applies the layout imperatively,
// reverting everything on unmount. The host's compact drawer has no such
// container; there the shared placement is left untouched.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { installEntry, pushCurrentDraft } from "@/components/draft-stack-actions";
import { useDraftStack, useIconAccent } from "@/components/use-draft-stack";
import { relativeSavedAt } from "@/draft-stack";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { computeDssPlacement } from "@/components/dss-placement";

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const now = Date.now();

  // Attach the DSS to the message box. The host wraps plugin popup content
  // in a full-composer-width card (rounded-md + border + bg-popover) inside
  // the shared typeahead container; that wrapper becomes the visible card
  // here — the popup root stays a plain see-through list and the wrapper is
  // restyled: flush against the composer on the chosen side, the shared
  // edge squared and border-less so the composer's border stands alone, the
  // other three edges double-thickness in a darkened border color, and the
  // width inset by the composer's corner radius so the squared corners never
  // poke onto the composer's rounding. Re-applied on every render (cheap
  // style writes) and fully reverted on unmount so the shared container
  // keeps its original mention-menu behavior.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const host: HTMLElement | null | undefined =
      root?.closest<HTMLElement>("[data-promptbox-typeahead-menu]");
    const form = host?.closest<HTMLElement>("[data-promptbox]") ?? null;
    const wrapper = host?.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
    if (!root || !host || !form || !wrapper) return;
    wrapper.classList.add("shadow-lg");

    function attach() {
      const rect = form!.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const { side, maxHeight } = computeDssPlacement(spaceAbove, spaceBelow, window.innerHeight, rem);
      const inset = parseFloat(getComputedStyle(form!).borderTopLeftRadius) || 12;
      // The container hangs 1px over each composer border (-left/right-px);
      // the same extra px keeps the popup centered on the composer itself.
      const insetPx = inset + 1;
      const maxH = `${maxHeight}px`;

      const rootCss = root!.style;
      rootCss.maxHeight = maxH;
      const css = wrapper!.style;
      css.marginInline = `${insetPx}px`;
      css.maxHeight = maxH;
      css.borderTopLeftRadius = side === "bottom" ? "0" : "";
      css.borderTopRightRadius = side === "bottom" ? "0" : "";
      css.borderBottomLeftRadius = side === "top" ? "0" : "";
      css.borderBottomRightRadius = side === "top" ? "0" : "";
      // The host container: flush against the composer, no gap, on the side
      // this popup picked (inline styles beat the host's mb/mt classes).
      const hs = host!.style;
      if (side === "top") {
        hs.top = "auto";
        hs.bottom = "100%";
      } else {
        hs.top = "100%";
        hs.bottom = "auto";
      }
      hs.margin = "0";
      // Double-thickness on every side that shows a border; for side "top"
      // the shared edge is the card's bottom edge, for "bottom" its top.
      // Darken the host's border color a shade.
      const base = getComputedStyle(wrapper!).borderTopColor;
      css.borderColor = `color-mix(in srgb, ${base} 75%, black)`;
      css.borderLeftWidth = "2px";
      css.borderRightWidth = "2px";
      css.borderTopWidth = side === "top" ? "2px" : "0";
      css.borderBottomWidth = side === "top" ? "0" : "2px";
    }

    attach();
    window.addEventListener("resize", attach);
    return () => {
      window.removeEventListener("resize", attach);
      const css = wrapper!.style;
      css.marginInline = "";
      css.maxHeight = "";
      css.borderTopLeftRadius = "";
      css.borderTopRightRadius = "";
      css.borderBottomLeftRadius = "";
      css.borderBottomRightRadius = "";
      css.borderColor = "";
      css.borderLeftWidth = "";
      css.borderRightWidth = "";
      css.borderTopWidth = "";
      css.borderBottomWidth = "";
      const rootCss = root!.style;
      rootCss.maxHeight = "";
      const hs = host!.style;
      hs.top = "";
      hs.bottom = "";
      hs.margin = "";
      wrapper.classList.remove("shadow-lg");
    };
  });

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
      ref={rootRef}
      role="listbox"
      aria-label="Draft Stack"
      tabIndex={0}
      onKeyDown={onKeyDown}
      autoFocus
      style={{
        // The selection halo wears the user's globally chosen bb-icon color.
        "--dss-halo": accent,
      } as React.CSSProperties}
      className="flex max-h-[min(60vh,24rem)] w-full min-w-0 flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Draft Stack
          {entries.length > 0 ? ` · ${entries.length}` : ""}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={composer.isEmpty || isBusy}
            onClick={() => void push()}
            title="Push the current draft onto the stack"
            aria-label="Push current draft onto the stack"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Icon name="ArrowUp" className="size-3" aria-hidden />
            Push
          </button>
          <button
            type="button"
            onClick={gotoSettings}
            title="Go to Draft Stack settings"
            aria-label="Go to Draft Stack settings"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="Settings" className="size-3" aria-hidden />
            Settings
          </button>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {stack === null ? (
          <p className="px-2 py-2 text-center text-[11px] text-muted-foreground">Loading the stack…</p>
        ) : entries.length === 0 ? (
          <div className="m-1.5 rounded-md border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
            The stack is empty. Push the current draft with “Push”.
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
                "mx-1 cursor-pointer rounded-md border border-transparent px-2 py-1 transition-[box-shadow,background-color]",
                index === highlight ? "bg-accent/40" : "hover:bg-accent/30",
              )}
            >
              <p
                className={cn(
                  "line-clamp-2 text-[13px] leading-snug whitespace-pre-wrap break-words",
                  entry.text === "" && "text-muted-foreground italic",
                )}
              >
                {entry.text === "" ? "(no text — attachments only)" : entry.text}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
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
    </div>
  );
}
