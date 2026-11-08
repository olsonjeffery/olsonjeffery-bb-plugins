// Press-and-hold for the touch paths: a held finger (or pen) on a thread row
// or a spool header resolves to the same context menu the ⋯ button and the
// right-click use. Relocation of spools and threads never involves a drag;
// this is one of the three openers that make that true on a phone.

/** Hold duration before the menu opens; slop is the movement cancel radius. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 8;

export type LongPressTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "spool"; spoolId: string }
  | null;

/**
 * What a pressed element stands for: the row's link first (thread, including
 * spool members), then a spool card (its header or its blank space). Details
 * panels, rename fields and anything else decline — a hold there is a hold,
 * not a gesture on the list.
 */
export function findLongPressTarget(el: Element | null): LongPressTarget {
  if (!el) return null;
  if (el.closest(".spooler-row-details")) return null;
  if (el.closest("input, textarea, .spooler-rename")) return null;
  const anchor = el.closest("[data-sidebar-thread-id]");
  if (anchor instanceof HTMLElement && anchor.dataset.sidebarThreadId) {
    return { kind: "thread", threadId: anchor.dataset.sidebarThreadId };
  }
  const spool = el.closest("[data-spool-id]");
  if (spool instanceof HTMLElement && spool.dataset.spoolId) {
    return { kind: "spool", spoolId: spool.dataset.spoolId };
  }
  return null;
}
