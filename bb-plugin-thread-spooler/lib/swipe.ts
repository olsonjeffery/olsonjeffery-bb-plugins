// Swipe-to-act on thread rows: the setting vocabulary and the gesture math.
// Plain TypeScript (no React, no DOM) so the backend can define the settings
// from the same list the row resolves them against.

export type SwipeActionId =
  | "read"
  | "pin"
  | "archive"
  | "split"
  | "rename"
  | "menu"
  | "delete"
  | "none";

/** Setting option text → action. The text is what the settings UI shows and
 *  also what is stored (select options are plain strings), so rewording one
 *  orphans saved choices: a stored value that no longer matches falls back to
 *  the side's default. Change a label only with that in mind. */
export const SWIPE_ACTION_OPTIONS = {
  "Mark read / unread": "read",
  "Pin / unpin": "pin",
  "Archive / unarchive": "archive",
  "Open in split": "split",
  Rename: "rename",
  "More actions": "menu",
  "Delete…": "delete",
  Nothing: "none",
} as const satisfies Record<string, SwipeActionId>;

export type SwipeActionOption = keyof typeof SWIPE_ACTION_OPTIONS;

export const SWIPE_ACTION_OPTION_LABELS = Object.keys(
  SWIPE_ACTION_OPTIONS,
) as SwipeActionOption[];

export const DEFAULT_SWIPE_RIGHT: SwipeActionOption = "Mark read / unread";
export const DEFAULT_SWIPE_LEFT: SwipeActionOption = "Archive / unarchive";

/** Unknown or missing setting values fall back instead of disabling a side. */
export function swipeActionFromSetting(
  value: unknown,
  fallback: SwipeActionOption,
): SwipeActionId {
  // Own keys only: `in` would also accept "constructor" or "toString".
  return typeof value === "string" && Object.hasOwn(SWIPE_ACTION_OPTIONS, value)
    ? SWIPE_ACTION_OPTIONS[value as SwipeActionOption]
    : SWIPE_ACTION_OPTIONS[fallback];
}

/** How the underlay presents an action for this thread's current state. */
export interface SwipeActionView {
  id: Exclude<SwipeActionId, "none">;
  label: string;
  icon: string;
  /** Slides the row away and folds it before acting, instead of springing back. */
  removes: boolean;
}

export function swipeActionView(
  id: SwipeActionId,
  thread: { isUnread: boolean; isPinned: boolean; isArchived: boolean },
  /** Whether the list shows only one of active or archived threads, so
   *  archiving or unarchiving takes the row out of it. */
  filtersArchived = true,
  /** Whether the host may ask to confirm before acting: archiving a thread
   *  with children archives them too. A folded row would sit hidden behind
   *  the dialog, so it springs back and the host removes it once confirmed. */
  mayConfirm = false,
): SwipeActionView | null {
  switch (id) {
    case "read":
      return thread.isUnread
        ? { id, label: "Read", icon: "MailOpen", removes: false }
        : { id, label: "Unread", icon: "Mail", removes: false };
    case "pin":
      return thread.isPinned
        ? { id, label: "Unpin", icon: "PinOff", removes: false }
        : { id, label: "Pin", icon: "Pin", removes: false };
    case "archive":
      return thread.isArchived
        ? { id, label: "Unarchive", icon: "ArchiveRestore", removes: filtersArchived }
        : {
            id,
            label: "Archive",
            icon: "Archive",
            removes: filtersArchived && !mayConfirm,
          };
    case "split":
      return { id, label: "Split", icon: "Columns2", removes: false };
    case "rename":
      return { id, label: "Rename", icon: "Edit", removes: false };
    case "menu":
      return { id, label: "More", icon: "MoreHorizontal", removes: false };
    case "delete":
      // The host confirms deletion, so the row stays until that resolves.
      return { id, label: "Delete", icon: "Trash2", removes: false };
    case "none":
    default:
      return null;
  }
}

/** Movement before a touch is read as a swipe or a scroll. */
export const SWIPE_SLOP_PX = 10;

/**
 * Distance that arms the action. A finger gets a third of the row, within
 * reach. A trackpad needs over half: its momentum adds travel after the lift
 * and a short push is easy to make by accident, so arming takes intent.
 */
export function swipeThreshold(
  rowWidth: number,
  input: "touch" | "trackpad" = "touch",
): number {
  if (input === "trackpad") return Math.min(240, Math.max(120, rowWidth * 0.55));
  return Math.min(128, Math.max(64, rowWidth * 0.3));
}

/**
 * Finger travel → row offset. Tracks 1:1 so the row stays under the finger,
 * then resists past most of the row. A side with no action only gives a
 * short elastic tug so it still answers the touch.
 */
export function swipeOffset(
  dx: number,
  rowWidth: number,
  hasAction: boolean,
): number {
  const sign = Math.sign(dx);
  const distance = Math.abs(dx);
  if (!hasAction) return sign * Math.min(28, distance * 0.2);
  const free = rowWidth * 0.8;
  if (distance <= free) return dx;
  return sign * (free + (distance - free) * 0.25);
}

/** A quick flick commits even short of the threshold. */
const FLING_PX_PER_MS = 0.5;
const FLING_MIN_PX = 32;

/**
 * Release decision. `velocity` is px/ms along x (positive = rightwards).
 * Past the threshold commits unless the finger was clearly pulling back.
 */
export function shouldCommitSwipe(
  offset: number,
  velocity: number,
  threshold: number,
): boolean {
  if (offset === 0) return false;
  const sign = Math.sign(offset);
  const along = velocity * sign;
  if (Math.abs(offset) >= threshold) return along > -FLING_PX_PER_MS;
  return Math.abs(offset) >= FLING_MIN_PX && along >= FLING_PX_PER_MS;
}

/** Spring tuning. `back` has a whisper of overshoot; `out` never bounces. */
export const SPRING_BACK = { stiffness: 420, damping: 34 } as const;
export const SPRING_OUT = { stiffness: 520, damping: 46 } as const;

/**
 * Advance a damped spring (unit mass) by `dtMs`, in fixed substeps so a
 * dropped frame cannot blow it up. Position in px, velocity in px/ms.
 */
export function stepSpring(
  x: number,
  velocity: number,
  target: number,
  dtMs: number,
  spring: { stiffness: number; damping: number },
): { x: number; velocity: number } {
  let pos = x;
  // The integration runs in seconds so the constants read like the usual
  // stiffness/damping pairs.
  let vel = velocity * 1000;
  let remaining = Math.min(dtMs, 64) / 1000;
  const step = 1 / 240;
  while (remaining > 0) {
    const dt = Math.min(step, remaining);
    const force = -spring.stiffness * (pos - target) - spring.damping * vel;
    vel += force * dt;
    pos += vel * dt;
    remaining -= dt;
  }
  return { x: pos, velocity: vel / 1000 };
}

/** Close enough to rest that another frame would not move a pixel. */
export function springAtRest(x: number, velocity: number, target: number): boolean {
  return Math.abs(x - target) < 0.5 && Math.abs(velocity) < 0.02;
}
