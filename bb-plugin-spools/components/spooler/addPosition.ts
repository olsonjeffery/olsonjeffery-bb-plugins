/**
 * Where a new thread lands inside a spool. Spool members sort oldest-first
 * (a work queue), so "add to top" cannot use a plain `Date.now()` join stamp
 * — it would sort last. `spoolJoined` is ordering-only metadata (never shown
 * as a date anywhere), so a top add writes a *negative* stamp `-Date.now()`:
 * it sorts before every positive-stamp member immediately, and successive
 * top adds become ever more negative, so each new arrival lands above the
 * last one. No sorting code needs to know the setting exists.
 *
 * The choice itself is the plugin's declarative `addPosition` setting
 * (server.ts, rendered in the host's main settings container); the sidebar
 * passes it into useSpools, so a change rebuilds the throw callbacks live.
 */

export type SpoolAddPosition = "bottom" | "top";

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
