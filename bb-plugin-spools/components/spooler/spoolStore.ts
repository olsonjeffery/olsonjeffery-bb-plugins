// Spool data model.
//
// All spool state lives in per-thread plugin metadata (pluginId "spools"),
// so membership is server-side — agents, the CLI, and any host can read it:
//
//   spool:       <spool id>            member of that spool
//   spoolJoined: <ms epoch number>     join order (stable member ordering)
//   spoolLead:   true                  the spool's Top / title-source thread
//   spoolTitle:  <string>              the spool's frozen title, kept on the lead
//                                      (named once at creation, replaced only
//                                      by an explicit user rename)
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
  /** True when leadThreadId was recovered by election (no member carries
   *  spoolLead) rather than read from real metadata. The next add
   *  reconciles it into actual metadata (planAddReconcile). */
  leadElected: boolean;
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

/** The title written on a lead when a spool names itself. Sourced from the
 *  lead thread at that moment; `customTitle` (a user rename) always wins. */
export function spoolTitleFor(lead: ThreadTitleSource | null, custom: string | null): string {
  if (custom && custom.trim()) return custom.trim();
  const base = lead ? (lead.displayTitle ?? lead.title ?? "") : "";
  // A spool whose lead thread is unresolvable (filtered out, deleted, or
  // renamed empty) must still name itself — an empty "Spool: " renders a
  // title-less card.
  return base.trim() ? `Spool: ${base}` : "Unnamed spool";
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
      spool = { id: membership.id, members: [], leadThreadId: null, leadElected: true, customTitle: null, title: "" };
      byId.set(membership.id, spool);
    }
    spool.members.push(thread.id);
    if (membership.lead) {
      spool.leadThreadId = thread.id;
      spool.leadElected = false;
    }
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
    // The title derives from the lead when it is resolvable, else from the
    // first member — a card whose lead row is filtered out (pinned into the
    // Pinned group, archived, hidden) must still name itself.
    const lead = spool.leadThreadId
      ? args.threads.find((thread) => thread.id === spool.leadThreadId) ?? null
      : null;
    const titleSource =
      lead ??
      (spool.members.length > 0
        ? args.threads.find((thread) => thread.id === spool.members[0]) ?? null
        : null);
    const leadMeta = spool.leadThreadId ? args.metadataByThreadId.get(spool.leadThreadId) : undefined;
    const customTitle =
      typeof leadMeta?.["spoolTitle"] === "string" && (leadMeta["spoolTitle"] as string).trim()
        ? (leadMeta["spoolTitle"] as string).trim()
        : null;
    spool.customTitle = customTitle;
    spool.title = spoolTitleFor(titleSource, customTitle);
  }

  // A spool with no members does not exist.
  const spools = [...byId.values()].filter((spool) => spool.members.length > 0);

  return { spools, membershipByThreadId };
}

/**
 * One-time reconciliation before a thread joins an existing spool: a lead
 * that was only recovered by election is persisted with spoolLead for real,
 * and a spool that still derives its title gets its CURRENT display title
 * written onto the lead. Both fixes are idempotent and only fire while the
 * hole exists, so the arrival itself (whose join stamp out-sorts the old
 * members under `addPosition: top`) can never rename the card or re-elect
 * the lead. The title is decided ONCE — at creation, or at the first add
 * that touches a spool created before titles were frozen.
 */
export function planAddReconcile(
  spool: Pick<Spool, "leadThreadId" | "leadElected" | "customTitle" | "title"> | null | undefined,
): SpoolMetadataWrite[] {
  if (!spool?.leadThreadId) return [];
  const set: Record<string, unknown> = {};
  if (spool.leadElected) set["spoolLead"] = true;
  if (!spool.customTitle) set["spoolTitle"] = spool.title;
  return Object.keys(set).length > 0 ? [{ threadId: spool.leadThreadId, set }] : [];
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
  | {
      kind: "create";
      spoolId: string;
      memberIds: readonly string[];
      leadId: string;
      /** The lead thread's current title, to freeze "Spool: <lead>" once. */
      leadTitle?: string | null;
      customTitle?: string | null;
      joinedAt: number;
    }
  | { kind: "add"; spoolId: string; memberIds: readonly string[]; joinedAt: number; customTitle?: string | null }
  | { kind: "breakOut"; threadIds: readonly string[] }
  | {
      kind: "rename";
      memberIds: readonly string[];
      leadId: string;
      customTitle: string | null;
      /** The derived title at rename time, frozen when clearing. */
      derivedTitle?: string | null;
    }
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
      // The spool names itself ONCE, right here: the lead carries spoolTitle
      // from the first write — a user-supplied name, or the derived
      // "Spool: <lead title>" ("Unnamed spool" when the lead cannot name
      // itself). Later adds, lead renames and lead handovers never re-derive
      // it; the user's next rename replaces the value.
      const provided = intent.customTitle && intent.customTitle.trim() ? intent.customTitle.trim() : null;
      const leadTitleSource: ThreadTitleSource | null =
        typeof intent.leadTitle === "string" && intent.leadTitle.trim()
          ? { id: intent.leadId, displayTitle: intent.leadTitle, title: intent.leadTitle }
          : null;
      const frozenTitle = provided ?? spoolTitleFor(leadTitleSource, null);
      return intent.memberIds.map((threadId, index) => ({
        threadId,
        ...memberPatch({
          spoolId: intent.spoolId,
          joined: intent.joinedAt + index,
          lead: threadId === intent.leadId,
          customTitle: threadId === intent.leadId ? frozenTitle : null,
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
      // Custom title lives on the lead thread only. Renaming replaces it;
      // CLEARING it re-freezes the title that currently derives, so the name
      // never returns to live derivation — nothing can retitle the spool
      // under the user's feet afterwards.
      return intent.customTitle && intent.customTitle.trim()
        ? [
            {
              threadId: intent.leadId,
              set: { spoolTitle: intent.customTitle.trim() },
            },
          ]
        : [
            {
              threadId: intent.leadId,
              set: { spoolTitle: (intent.derivedTitle ?? "").trim() || "Unnamed spool" },
            },
          ];
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
 * next member (by join order) is elected. The election is PERSISTED — the
 * promoted member now truly carries spoolLead, so a later add (whose top
 * join stamps out-sort the positives) can never re-elect a different lead —
 * and the old lead's custom title follows so a rename survives the handover.
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
  const set: Record<string, unknown> = { spoolLead: true };
  if (args.oldLeadCustomTitle) set["spoolTitle"] = args.oldLeadCustomTitle;
  return [{ threadId: next, set }];
}
