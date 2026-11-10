// Thread Tags integration (VladPolet's bb-plugin-thread-tags).
//
// The other plugin owns ONE configurable tag set (an emoji or short label on
// a colored badge, up to one tag per thread). Spools is a reader: the sidebar
// rides its tags on the row summary box, the details panel and the spool
// cards' title-bar rollup — it never writes assignments. Everything degrades
// quietly when the plugin is absent: no badges, no extra requests beyond one
// failed availability probe.
import { z } from "zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";

/** The other plugin's installed id ("thread-tags"). */
export const THREAD_TAGS_PLUGIN_ID = "thread-tags";

/**
 * Where Thread Tags rides when it is missing — the one-click install inside
 * the Plugin health settings card hands this same source to bb's installer
 * (mirroring what the Personas settings page exposes for this plugin).
 */
export const THREAD_TAGS_PLUGIN_SOURCE =
  "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0";

/** The bare fallback the one-click install retries with when bb rejects the
 *  range-suffixed git source. */
export const THREAD_TAGS_PLUGIN_URL = "https://github.com/VladPolet/bb-plugin-thread-tags";

/** The other plugin's realtime channel; every write publishes here. */
export const THREAD_TAGS_CHANNEL = "tags-changed";

/** bb's own publish when the installed-plugin set changes. */
export const PLUGINS_CHANGED_CHANNEL = "plugins-changed";

/**
 * Statuses where an installed plugin row counts as usable — the same rule
 * the Personas plugin-health read applies: not disabled, not missing, not a
 * hard failure, not still starting. Unknown statuses read available, so a
 * future bb status name must not silently blank every badge.
 */
const UNAVAILABLE_PLUGIN_STATUSES = new Set([
  "disabled",
  "missing",
  "error",
  "incompatible",
  "starting",
]);

/** Distinct tags a spool's title bar shows before the "+N" overflow chip. */
export const TAG_ROLLUP_LIMIT = 4;

/** One configured tag, exactly the shape thread-tags serves. */
export interface TagInfo {
  id: string;
  label: string;
  color: string;
}

/** The other plugin's state_get contract, minimally read. */
export interface TagState {
  tags: TagInfo[];
  /** threadId → tagId. */
  assignments: Record<string, string>;
}

export const stateSchema = z.object({
  tags: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      color: z.string(),
    }).strip(),
  ),
  // assignments: thread id → tag id (values may name tags that no longer
  // exist; every consumer resolves through `tags` and skips unknown ids).
  assignments: z.record(z.string(), z.string()),
}).strip();

export const ThreadTagsStateOutput = stateSchema;

/**
 * The thread's one tag, or null. Assignments pointing at deleted tag ids
 * resolve to null — the other plugin already prunes them, and a stale row
 * between publishes must not paint a badge it cannot back.
 */
export function tagForThread(state: TagState, threadId: string): TagInfo | null {
  const id = state.assignments[threadId];
  if (typeof id !== "string") return null;
  return state.tags.find((tag) => tag.id === id) ?? null;
}

/** Minimal thread shape the rollup reads (PluginSidebarThread rows). */
export interface RollupThread {
  id: string;
  indicator?: string | null;
  isUnread?: boolean;
}

/**
 * Attention rank for the rollup's priority order — the same axes the
 * family rollup uses on the row sub-head: failed > needs you > unread >
 * working > idle. A tag worn by loudest members leads the spool's title bar.
 */
export function tagWearerPriority(thread: RollupThread): number {
  switch (thread.indicator) {
    case "unread-error":
    case "queued-failed":
      return 4;
    case "waiting-for-input":
    case "queued-waiting":
      return 3;
    case "runtime":
    case "working-draft":
      // Working outranks plain IDLE but yields to attention states.
      return thread.isUnread ? 2 : 1;
    default:
      return thread.isUnread ? 2 : 0;
  }
}

export interface RolledUpTag {
  tag: TagInfo;
  /** Threads in the group wearing this tag. */
  wornBy: number;
  /** The loudest attention any wearer carries (4 failed … 0 idle). */
  priority: number;
}

/**
 * Roll up every group member's tag into one deduped, priority-ordered list:
 * attention first, more wearers next, then the tag's label for stability.
 * Stale assignments and untagged members contribute nothing.
 */
export function rollupThreadTags(
  state: TagState | null,
  members: readonly RollupThread[],
): RolledUpTag[] {
  if (!state) return [];
  const rolled = new Map<string, RolledUpTag>();
  for (const thread of members) {
    const tag = tagForThread(state, thread.id);
    if (!tag) continue;
    let entry = rolled.get(tag.id);
    if (!entry) {
      entry = { tag, wornBy: 0, priority: 0 };
      rolled.set(tag.id, entry);
    }
    entry.wornBy += 1;
    entry.priority = Math.max(entry.priority, tagWearerPriority(thread));
  }
  return [...rolled.values()].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.wornBy - a.wornBy ||
      a.tag.label.localeCompare(b.tag.label) ||
      a.tag.id.localeCompare(b.tag.id),
  );
}

/** Minimal sdk surface this hook needs (tests stub just these). */
export interface TagsSdkClient {
  plugins: {
    list(): Promise<{
      plugins: readonly {
        id: string;
        enabled: boolean;
        status: string;
        version?: string;
      }[];
    }>;
    callRpc(args: {
      pluginId: string;
      method: string;
      input?: unknown;
      outputSchema: unknown;
    }): Promise<unknown>;
  };
}



export interface PluginRow {
  id: string;
  enabled: boolean;
  status: string;
  version?: string;
}

/** One settings-page health readout for the Thread Tags plugin. */
export interface ThreadTagsHealth {
  installed: boolean;
  enabled: boolean;
  status: string | null;
  version: string | null;
  /** Installed, enabled, and not in a hard-failure status. */
  available: boolean;
}

/**
 * The settings card's health readout from one fresh installed-plugin list
 * (the same rule the availability probe uses). An absent row reads "not
 * installed"; the UI decides which of that and "disabled" gets an action.
 */
export function threadTagsHealthOf(
  plugins: readonly PluginRow[],
): ThreadTagsHealth {
  const row = plugins.find((plugin) => plugin.id === THREAD_TAGS_PLUGIN_ID);
  return {
    installed: row !== undefined,
    enabled: row?.enabled ?? false,
    status: row?.status ?? null,
    version: row?.version ?? null,
    available:
      row !== undefined &&
      row.enabled &&
      !UNAVAILABLE_PLUGIN_STATUSES.has(row.status),
  };
}

/** The settings card's detail line: state + version, Personas' wording. */
export function threadTagsHealthDetail(tool: ThreadTagsHealth): string {
  if (!tool.installed) return "Not installed";
  if (!tool.enabled) return "Installed — disabled";
  const status =
    tool.status === null
      ? "Installed"
      : tool.status === "running"
        ? "Running"
        : `Installed — ${tool.status}`;
  return tool.version === null ? status : `${status} · v${tool.version}`;
}

export interface UseThreadTagsResult {
  status: "idle" | "loading" | "ready";
  /** null while the plugin is absent or its state has not read. */
  state: TagState | null;
  /** Thread Tags is installed, enabled, and its state has resolved. */
  available: boolean;
  /** Per-thread tag lookup; empty while unavailable. */
  tagFor(threadId: string): TagInfo | null;
}

/**
 * Reads the other plugin's tag state for the sidebar's badges. Refreshes: on
 * mount, on thread-tags' `tags-changed` signal, and on the app reconnecting
 * (missed signals) plus bb's `plugins-changed` (install/enable while the list
 * is open). Every failure degrades to "unavailable" — the list never holds a
 * spinner or state for the badges it cannot read.
 */
export function useThreadTags(sdk: TagsSdkClient | null): UseThreadTagsResult {
  const [state, setState] = useState<TagState | null>(null);
  const [status, setStatus] = useState<UseThreadTagsResult["status"]>("idle");

  const refresh = useMemo(
    () =>
      async () => {
        if (!sdk?.plugins) return;
        setStatus((s) => (s === "ready" ? s : "loading"));
        let next: TagState | null = null;
        try {
          const listed = await sdk.plugins.list();
          const row = listed.plugins.find(
            (plugin) => plugin.id === THREAD_TAGS_PLUGIN_ID,
          );
          if (
            row &&
            row.enabled &&
            !UNAVAILABLE_PLUGIN_STATUSES.has(row.status)
          ) {
            next = stateSchema.parse(
              await sdk.plugins.callRpc({
                pluginId: THREAD_TAGS_PLUGIN_ID,
                method: "state_get",
                input: null,
                outputSchema: stateSchema,
              }),
            );
          }
        } catch {
          // Availability probe or read failed: degrade to unavailable so an
          // enabled-then-broken plugin never stale-paints.
          next = null;
        }
        setState(next);
        setStatus("ready");
      },
    [sdk],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Missed or quiet writes arrive through the shared realtime connection.
  useRealtime(THREAD_TAGS_CHANNEL, () => void refresh());
  useRealtime(PLUGINS_CHANGED_CHANNEL, () => void refresh());
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    // The first transition is "connecting" → "connected": reconcile once so
    // an instance-wide signal missed while offline still lands.
    if (connection === "connected") void refresh();
  }, [connection, refresh]);

  const lookup = useMemo(() => {
    if (!state) return new Map<string, TagInfo>();
    const byThreadId = new Map<string, TagInfo>();
    for (const [threadId, tagId] of Object.entries(state.assignments)) {
      const tag = state.tags.find((candidate) => candidate.id === tagId);
      if (tag) byThreadId.set(threadId, tag);
    }
    return byThreadId;
  }, [state]);

  const tagFor = useCallback(
    (threadId: string): TagInfo | null => lookup.get(threadId) ?? null,
    [lookup],
  );

  return {
    status: status === "ready" && state !== null ? "ready" : status,
    state,
    available: state !== null,
    tagFor,
  };
}
