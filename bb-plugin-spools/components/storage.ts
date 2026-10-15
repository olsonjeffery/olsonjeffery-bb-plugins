/**
 * One-time preference migration from the `codex-sidebar:` and
 * `spooler-sidebar:` eras.
 *
 * The plugin is now named Spools, and its per-client preferences (grouping,
 * density, collapsed groups and families, project order, status filter, saved
 * smart views) live under a namespaced localStorage key. Without this pass
 * those would silently reset on first launch under the new name.
 */

const CURRENT_PREFIX = "spools:";
const LEGACY_PREFIXES = ["codex-sidebar:", "spooler-sidebar:"];

/**
 * Keys that were retired when nav placement moved to BB's own server-synced
 * UI preferences. They are deleted rather than carried over.
 */
const RETIRED = new Set([
  `${LEGACY_PREFIXES[0]}nav-pinned:v1`,
  `${LEGACY_PREFIXES[0]}nav-hidden:v1`,
]);

const MIGRATION_FLAG = `${CURRENT_PREFIX}migrated:v1`;

function available(): boolean {
  return typeof window !== "undefined" && "localStorage" in window;
}

/**
 * Copy every legacy key forward once, then drop the originals.
 *
 * Existing current-prefix values win: if the user already changed a setting
 * after the rename, the migration must not clobber it.
 */
export function migrateLegacyPreferences(): void {
  if (!available()) return;
  try {
    if (window.localStorage.getItem(MIGRATION_FLAG) !== null) return;
  } catch {
    return;
  }

  const legacyKeys: string[] = [];
  try {
    for (const prefix of LEGACY_PREFIXES) {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(prefix)) legacyKeys.push(key);
      }
    }
  } catch {
    return;
  }

  // Any key that could not be moved leaves the flag unset, so the next launch
  // retries instead of silently abandoning it.
  let complete = true;
  for (const key of legacyKeys) {
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      if (RETIRED.has(key)) {
        window.localStorage.removeItem(key);
        continue;
      }
      const prefix =
        LEGACY_PREFIXES.find((candidate) => key.startsWith(candidate)) ??
        LEGACY_PREFIXES[0];
      const target = CURRENT_PREFIX + key.slice(prefix.length);
      if (window.localStorage.getItem(target) === null) {
        window.localStorage.setItem(target, value);
      }
      window.localStorage.removeItem(key);
    } catch {
      // Storage full or blocked: leave this key for the next launch.
      complete = false;
    }
  }
  if (!complete) return;

  try {
    window.localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // Not fatal: the copy is idempotent because it skips existing targets.
  }
}
