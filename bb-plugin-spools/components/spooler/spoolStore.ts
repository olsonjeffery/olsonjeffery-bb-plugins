// Spool data model.
//
// All spool state lives in per-thread plugin metadata (pluginId "spools"),
// so membership is server-side — agents, the CLI, and any host can read it:
//
//   spool:       <spool id>            member of that spool
//   spoolJoined: <ms epoch number>     join order (stable member ordering)
//   spoolLead:   true                  the spool's Top / title-source thread
//   spoolTitle:  <string>              optional custom title, kept on the lead
//
// A spool exists only where members carry the metadata — an empty spool
// simply disappears. This module owns the shapes and pure derivations; the
// sdk calls live in useSpools (app side).
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** Per-thread spool membership as it appears in plugin metadata. */
export interface SpoolMembership {
  /** Spool id the thread belongs to. */
  id: string;
  /** Epoch ms of the moment the thread joined (update order key). */
  joined: number;
  /** True on the spool's Top thread (title source, "Open top thread"). */
  lead: boolean;
}

/** A resolved spool ready for rendering. */
export interface Spool {
  id: string;
  /** Member threadIds ordered by join time (oldest first). */
  members: string[];
  /** The Top thread — first to join (elected if the original lead left). */
  leadThreadId: string | null;
  /** Custom title if the user renamed the spool, else null. */
  customTitle: string | null;
  /** Resolved display title: customTitle ?? `Spool: <lead thread title>`. */
  title: string;
}

export const SPOOL_ID_PREFIX = "spool_";

/** Metadata keys owned by this plugin. All live under the spool namespace. */
export const SPOOL_META_KEYS = ["spool", "spoolJoined", "spoolLead", "spoolTitle"] as const;

type ThreadTitleSource = Pick<PluginSidebarThread, "id" | "displayTitle" | "title">;

/** `spool_<8 hex>` — collision odds at any realistic spool count are nil. */
export function newSpoolId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${SPOOL_ID_PREFIX}${hex}`;
}

/** Default spool title derives from the Top thread at creation time. */
export function spoolTitleFor(lead: ThreadTitleSource | null, custom: string | null): string {
  if (custom && custom.trim()) return custom.trim();
  const base = lead ? (lead.displayTitle ?? lead.title ?? "") : "";
  return `Spool: ${base}`;
}

function readMembership(
  threadId: string,
  metadata: Record<string, unknown>,
): SpoolMembership | null {
  const id = metadata["spool"];
  if (typeof id !== "string" || !id.startsWith(SPOOL_ID_PREFIX)) return null;
  const joined = typeof metadata["spoolJoined"] === "number" ? metadata["spoolJoined"] : 0;
  const lead = metadata["spoolLead"] === true;
  return { id, joined, lead };
}

/**
 * Fold per-thread metadata rows into resolved spools. Rows with no spool
 * metadata are ignored. Lead election: the original lead keeps the role
 * while present; if it vanished (archived/unspooled), the oldest remaining
 * member takes over but does NOT inherit a custom title already stored on
 * the old lead — see `electLeadPatch` which migrates it on the way out.
 */
export function deriveSpools(args: {
  /** All threads the sidebar currently surfaces (active OR archived). */
  threads: readonly Pick<PluginSidebarThread, "id" | "displayTitle" | "title">[];
  /** pluginId="spools" metadata per thread id, when present. */
  metadataByThreadId: ReadonlyMap<string, Record<string, unknown>>;
}): { spools: Spool[]; membershipByThreadId: ReadonlyMap<string, SpoolMembership> } {
  const byId = new Map<string, Spool>();
  const membershipByThreadId = new Map<string, SpoolMembership>();

  for (const thread of args.threads) {
    const meta = args.metadataByThreadId.get(thread.id);
    if (!meta) continue;
    const membership = readMembership(thread.id, meta);
    if (!membership) continue;
    membershipByThreadId.set(thread.id, membership);
    let spool = byId.get(membership.id);
    if (!spool) {
      spool = { id: membership.id, members: [], leadThreadId: null, customTitle: null, title: "" };
      byId.set(membership.id, spool);
    }
    spool.members.push(thread.id);
    if (membership.lead) spool.leadThreadId = thread.id;
  }

  // Order members by join time (ties: first-seen), elect a lead if none
  // survived, and resolve titles. Members sort oldest-first so a spool reads
  // like a work queue.
  for (const spool of byId.values()) {
    // Members sort oldest-first so a spool reads like a work queue; ties
    // fall back to thread id for determinism.
    spool.members.sort((a, b) => {
      const ja = membershipByThreadId.get(a)?.joined ?? 0;
      const jb = membershipByThreadId.get(b)?.joined ?? 0;
      return ja !== jb ? ja - jb : a.localeCompare(b);
    });
    if (!spool.leadThreadId && spool.members.length > 0) spool.leadThreadId = spool.members[0];
    const lead = spool.leadThreadId
      ? args.threads.find((thread) => thread.id === spool.leadThreadId) ?? null
      : null;
    const leadMeta = spool.leadThreadId ? args.metadataByThreadId.get(spool.leadThreadId) : undefined;
    const customTitle =
      typeof leadMeta?.["spoolTitle"] === "string" && (leadMeta["spoolTitle"] as string).trim()
        ? (leadMeta["spoolTitle"] as string).trim()
        : null;
    spool.customTitle = customTitle;
    spool.title = spoolTitleFor(lead, customTitle);
  }

  // A spool with no members does not exist.
  const spools = [...byId.values()].filter((spool) => spool.members.length > 0);

  return { spools, membershipByThreadId };
}

/**
 * Metadata patch for one thread joining spool `spoolId` at `joined`.
 * - Always sets spool/spoolJoined so membership is unambiguous.
 * - Sets spoolLead true only when the thread is the lead; removes spoolTitle
 *   unless the thread carries the custom title (prevents stale overrides
 *   surviving a break-out from another spool).
 */
export function memberPatch(args: {
  spoolId: string;
  joined: number;
  lead: boolean;
  customTitle?: string | null;
}): { set: Record<string, unknown>; remove?: string[] } {
  const set: Record<string, unknown> = {
    spool: args.spoolId,
    spoolJoined: args.joined,
    spoolLead: args.lead,
  };
  const remove: string[] = [];
  if (args.customTitle && args.customTitle.trim()) {
    set["spoolTitle"] = args.customTitle.trim();
  } else {
    remove.push("spoolTitle");
  }
  return remove.length > 0 ? { set, remove } : { set };
}

/** Patch when a thread leaves any spool: drop every spool key at once. */
export function releasePatch(): { set: undefined; remove: string[] } {
  return { set: undefined, remove: [...SPOOL_META_KEYS] };
}

/* ————————————————————————————————————————————————————————————————
   Intent → metadata patches.

   Spool mutations are expressed as intents over current state (threads +
   membership), each resolved to one `threads.updatePluginMetadata` call per
   touched thread. Agents and threads outside this sidebar understand the
   same metadata because it is written server-side.
   ———————————————————————————————————————————————————————————————— */

/** A single metadata write the sdk should perform. */
export interface SpoolMetadataWrite {
  threadId: string;
  set?: Record<string, unknown>;
  remove?: string[];
}

export interface DescendantsOfArgs {
  threadId: string;
  /** parentThreadId → child thread ids, from the live thread list. */
  childrenOf: ReadonlyMap<string, readonly string[]>;
}

/**
 * The thread's family (itself + every descendant, breadth-first). Spooling a
 * thread pulls its whole family in, so children are members with their own
 * metadata — visible to agents, CLI, and the spool card alike.
 */
export function familyOf({ threadId, childrenOf }: DescendantsOfArgs): string[] {
  const family: string[] = [];
  const seen = new Set<string>();
  const queue = [threadId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    family.push(id);
    for (const childId of childrenOf.get(id) ?? []) queue.push(childId);
  }
  return family;
}

export type SpoolIntent =
  | { kind: "create"; spoolId: string; memberIds: readonly string[]; leadId: string; customTitle?: string | null; joinedAt: number }
  | { kind: "add"; spoolId: string; memberIds: readonly string[]; joinedAt: number; customTitle?: string | null }
  | { kind: "breakOut"; threadIds: readonly string[] }
  | { kind: "rename"; memberIds: readonly string[]; leadId: string; customTitle: string | null }
  | { kind: "unspool"; spoolId: string; memberIds: readonly string[] };

/**
 * Resolve an intent into concrete metadata writes. Membership edits always
 * rewrite the full spool key-set (spool/spoolJoined/spoolLead) so a stale
 * `spoolLead` or `spoolTitle` from a previous spool cannot survive a move.
 */
export function planMetadataWrites(
  intent: SpoolIntent,
  membershipByThreadId: ReadonlyMap<string, SpoolMembership>,
): SpoolMetadataWrite[] {
  switch (intent.kind) {
    case "create": {
      return intent.memberIds.map((threadId, index) => ({
        threadId,
        ...memberPatch({
          spoolId: intent.spoolId,
          joined: intent.joinedAt + index,
          lead: threadId === intent.leadId,
          customTitle: threadId === intent.leadId ? (intent.customTitle ?? null) : null,
        }),
      }));
    }
    case "add": {
      return intent.memberIds.map((threadId, index) => ({
        threadId,
        ...memberPatch({
          spoolId: intent.spoolId,
          joined: intent.joinedAt + index,
          lead: false,
          customTitle: null,
        }),
      }));
    }
    case "breakOut": {
      return intent.threadIds
        .filter((threadId) => membershipByThreadId.has(threadId))
        .map((threadId) => ({ threadId, ...releasePatch() }));
    }
    case "rename": {
      // Custom title lives on the lead thread only; clearing it restores the
      // derived "Spool: <lead>" naming everywhere else.
      return intent.customTitle && intent.customTitle.trim()
        ? [
            {
              threadId: intent.leadId,
              set: { spoolTitle: intent.customTitle.trim() },
            },
          ]
        : [{ threadId: intent.leadId, remove: ["spoolTitle"] }];
    }
    case "unspool": {
      return intent.memberIds.map((threadId) => ({
        threadId,
        ...releasePatch(),
      }));
    }
  }
}

/**
 * Lead migration: when the current lead leaves (archived / broken out) the
 * next member (by join order) is elected and — if it never held one — the
 * old lead's custom title follows so a rename survives the handover.
 */
export function planLeadMigration(args: {
  spoolId: string;
  memberIds: readonly string[];
  leavingLeadId: string;
  oldLeadCustomTitle: string | null;
  joinedAt: number;
}): SpoolMetadataWrite[] {
  const next = args.memberIds.find((memberId) => memberId !== args.leavingLeadId);
  if (!next) return [];
  const writes: SpoolMetadataWrite[] = [];
  if (args.oldLeadCustomTitle) {
    writes.push({ threadId: next, set: { spoolTitle: args.oldLeadCustomTitle } });
  }
  return writes;
}
