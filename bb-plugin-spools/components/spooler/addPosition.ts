/**
 * Where a new thread lands inside a spool. Spool members sort oldest-first
 * (a work queue), so "add to top" cannot use a plain `Date.now()` join stamp
 * — it would sort last. `spoolJoined` is ordering-only metadata (never shown
 * as a date anywhere), so a top add writes a *negative* stamp `-Date.now()`:
 * it sorts before every positive-stamp member immediately, and successive
 * top adds become ever more negative, so each new arrival lands above the
 * last one. No sorting code needs to know the setting exists.
 *
 * Persists per device in localStorage (same reasoning as section colors:
 * the server's spool metadata carries no preference slot). The sidebar
 * reads the setting at the moment an add happens, so no subscription is
 * needed there; the event bus below only serves live-repainting consumers.
 */

const ADD_POSITION_KEY = "spooler-sidebar:add-position:v1";

export type SpoolAddPosition = "bottom" | "top";

export const ADD_POSITION_EVENT = "spooler-add-position-changed";

export function readAddPosition(): SpoolAddPosition {
  try {
    return localStorage.getItem(ADD_POSITION_KEY) === "top" ? "top" : "bottom";
  } catch {
    return "bottom";
  }
}

export function writeAddPosition(position: SpoolAddPosition): void {
  try {
    localStorage.setItem(ADD_POSITION_KEY, position);
    // Same window: tell any mounted consumer directly.
    window.dispatchEvent(new CustomEvent(ADD_POSITION_EVENT));
  } catch {
    // No storage: the setting just stays at its default for this session.
  }
}

/**
 * The `spoolJoined` value for a thread joining a spool right now, honoring
 * the user's add-position preference. Family members get `+ index` offsets
 * downstream, so within one add the parent still sorts above its children
 * even on a negative stamp.
 */
export function joinStampFor(position: SpoolAddPosition): number {
  const now = Date.now();
  return position === "top" ? -now : now;
}
