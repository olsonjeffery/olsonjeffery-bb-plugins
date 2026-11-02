// bb-plugin-microsandbox-pi — npm "latest available" answers.
//
// Pure logic here (TTL decisions, dist-tag parsing, staleness); the
// network fetch lives in server.ts so it can ride the cycle's signal.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { type NpmLatestEntry, type ToolStatus } from "./snapshot";

export const NPM_LATEST_KEY = "npm-latest";
export const NPM_LATEST_TTL_MS = 6 * 60 * 60 * 1000;
export const NPM_FETCH_TIMEOUT_MS = 6_000;

export type NpmLatestCache = Record<string, NpmLatestEntry>;

export async function loadNpmLatest(bb: BbPluginApi): Promise<NpmLatestCache> {
  const row = await bb.storage.kv.get<Record<string, unknown>>(NPM_LATEST_KEY);
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const cache: NpmLatestCache = {};
  for (const [packageName, value] of Object.entries(row)) {
    const entry = value as Partial<NpmLatestEntry> | undefined;
    if (entry && typeof entry === "object" && typeof entry.fetchedAt === "number") {
      // version is nullable (registry reachable, but no latest dist-tag).
      cache[packageName] = {
        packageName,
        version: typeof entry.version === "string" ? entry.version : null,
        fetchedAt: entry.fetchedAt,
        stale: entry.stale === true,
      };
    }
  }
  return cache;
}

export async function saveNpmLatest(bb: BbPluginApi, cache: NpmLatestCache): Promise<void> {
  await bb.storage.kv.set(NPM_LATEST_KEY, cache);
}

/** Packages the fleet actually references (pi + msb installs). */
export function packageNamesOf(machineSnapshots: readonly { pi: ToolStatus; msb: ToolStatus }[]): string[] {
  const names = new Set<string>();
  for (const snapshot of machineSnapshots) {
    for (const status of [snapshot.pi, snapshot.msb]) {
      if (status?.packageName) names.add(status.packageName);
    }
  }
  return [...names].sort();
}

/** Entries due for a refetch: never seen, past TTL, or clean up stale
 * rows (a stale entry is refreshed too — it carries a failed attempt). */
export function dueForRefetch(cache: NpmLatestCache, packageNames: readonly string[], now: number): string[] {
  return packageNames.filter((packageName) => {
    const entry = cache[packageName];
    if (!entry) return true;
    return entry.stale === true || now - entry.fetchedAt > NPM_LATEST_TTL_MS;
  });
}

/** A registry dist-tags document: {"latest":"0.7.13","rc":"…"} — hosts
 * may add keys; only "latest" matters. A full packument (with a
 * `dist-tags` member) also parses, because the endpoint contract is
 * worth tolerating both ways. Types are checked, not trusted. */
export function parseDistTags(payload: string): { latest: string | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { latest: null, error: "registry returned non-JSON" };
  }
  if (!isObject(parsed)) return { latest: null, error: "registry answer is not an object" };
  const tags = isObject(parsed["dist-tags"]) ? parsed["dist-tags"] : parsed;
  const latest = tags.latest;
  if (typeof latest === "string" && latest.trim() !== "") return { latest: latest.trim(), error: null };
  if (latest === undefined) return { latest: null, error: "registry answer has no latest dist-tag" };
  return { latest: null, error: "latest dist-tag is not a version string" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge one fetch result into the cache; failures keep the previous
 * data but flag it stale so both the UI and the next cycle notice. */
export function applyNpmResult(
  cache: NpmLatestCache,
  packageName: string,
  result: { latest: string | null; error: string | null },
  now: number,
): NpmLatestCache {
  const previous = cache[packageName];
  const next: NpmLatestEntry = result.error
    ? {
        packageName,
        version: previous && !previous.stale ? previous.version : null,
        fetchedAt: now,
        stale: true,
      }
    : { packageName, version: result.latest, fetchedAt: now, stale: false };
  return { ...cache, [packageName]: next };
}

/** Filtered projection for the watch contract: only the packages the
 * fleet still installs, sorted by package name. */
export function projectNpmLatest(cache: NpmLatestCache, packageNames: readonly string[]): NpmLatestEntry[] {
  return [...packageNames]
    .sort()
    .filter((packageName) => cache[packageName] !== undefined)
    .map((packageName) => cache[packageName]);
}
