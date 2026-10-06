// bb-plugin-draft-stack — shared stack model and limits.
//
// One stack, one JSON array. Array order is the stack order: index 0 is the
// BOTTOM, the LAST element is the TOP. New pushes append at the end; the Pop
// operation removes and returns the last element. Every surface (popup,
// palette commands, settings, CLI) reads/writes this same array.

/** Cap on a single draft's text; a composer draft well above this is abuse. */
export const MAX_TEXT_LENGTH = 200_000;
/** Cap on entries; pushing beyond this drops the OLDEST (bottom) entries. */
export const MAX_STACK_ENTRIES = 100;
export const MAX_MENTIONS_PER_DRAFT = 200;
export const MAX_ATTACHMENTS_PER_DRAFT = 50;

export type DraftStackAttachment = {
  type: "localFile" | "localImage";
  name: string;
  path: string;
  sizeBytes: number;
  mimeType?: string;
};

export type DraftStackMention = {
  from: number;
  to: number;
  label: string;
  kind: "thread" | "project" | "section" | "path" | "command" | "plugin";
  // Variant fields live in rawEntry passthrough land: the wire schemas spell
  // them out per kind (server.ts zod); this type stays loose on purpose so
  // host mention objects pass back through replace() untouched.
  [field: string]: unknown;
};

/** One saved composer draft, as it was captured from the composer. */
export type DraftStackEntry = {
  id: string;
  text: string;
  mentions: DraftStackMention[];
  attachments: DraftStackAttachment[];
  /** Project the composer belonged to when pushed (new-thread scope, or the thread's project). Null when unknown. */
  projectId: string | null;
  /** Thread the composer belonged to when pushed. Null for new-thread pushes. */
  threadId: string | null;
  createdAt: number;
};

/** True when a draft carries anything at all. */
export function draftIsEmpty(draft: { text: string; mentions: unknown[]; attachments: unknown[] }): boolean {
  return (
    draft.text.trim().length === 0 &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0
  );
}

export function newDraftStackId(now: number): string {
  const entropy = Math.random().toString(36).slice(2, 8);
  return `dsk_${now.toString(36)}_${entropy}`;
}

/**
 * Coerces one raw rewrite entry into a DraftStackEntry. On purpose lenient:
 * unknown object keys are PRESERVED verbatim (an arbitrary rewrite of the
 * stack structure keeps the writer's extra fields), while the fields the
 * stack itself cares about are normalized and backfilled.
 */
export function sanitizeEntry(raw: unknown, now: number): DraftStackEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rawObject = raw as Record<string, unknown>;
  const text = typeof rawObject.text === "string" ? rawObject.text : "";
  const mentions = sanitizeMentions(rawObject.mentions);
  const attachments = sanitizeAttachments(rawObject.attachments);
  const saved = typeof rawObject.createdAt === "number" ? rawObject.createdAt : now;
  return {
    id:
      typeof rawObject.id === "string" && rawObject.id !== ""
        ? rawObject.id
        : newDraftStackId(saved),
    text,
    mentions,
    attachments,
    projectId:
      typeof rawObject.projectId === "string" && rawObject.projectId !== ""
        ? rawObject.projectId
        : null,
    threadId:
      typeof rawObject.threadId === "string" && rawObject.threadId !== ""
        ? rawObject.threadId
        : null,
    createdAt: saved,
    // Unknown extras travel below verbatim:
    ...rawRecordExtras(rawObject),
  };
}

function rawRecordExtras(rawObject: Record<string, unknown>): Record<string, unknown> | undefined {
  const KNOWN = new Set([
    "id",
    "text",
    "mentions",
    "attachments",
    "projectId",
    "threadId",
    "createdAt",
  ]);
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawObject)) {
    if (typeof key === "string" && !KNOWN.has(key)) extras[key] = value;
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function sanitizeMentions(raw: unknown): DraftStackMention[] {
  if (!Array.isArray(raw)) return [];
  const mentions: DraftStackMention[] = [];
  for (const candidate of raw.slice(0, MAX_MENTIONS_PER_DRAFT)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const mention = candidate as Record<string, unknown>;
    if (typeof mention.kind !== "string") continue;
    if (typeof mention.label !== "string") continue;
    const from = typeof mention.from === "number" ? mention.from : Number(mention.from);
    const to = typeof mention.to === "number" ? mention.to : Number(mention.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) continue;
    mentions.push({ ...mention, kind: mention.kind, label: mention.label, from, to } as DraftStackMention);
  }
  return mentions;
}

function sanitizeAttachments(raw: unknown): DraftStackAttachment[] {
  if (!Array.isArray(raw)) return [];
  const attachments: DraftStackAttachment[] = [];
  for (const candidate of raw.slice(0, MAX_ATTACHMENTS_PER_DRAFT)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const attachment = candidate as Record<string, unknown>;
    if (attachment.type !== "localFile" && attachment.type !== "localImage") continue;
    if (typeof attachment.name !== "string" || attachment.name === "") continue;
    if (typeof attachment.path !== "string" || attachment.path === "") continue;
    attachments.push({
      type: attachment.type,
      name: attachment.name,
      path: attachment.path,
      sizeBytes: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : 0,
      ...(typeof attachment.mimeType === "string" ? { mimeType: attachment.mimeType } : {}),
    });
  }
  return attachments;
}

/**
 * Normalizes a whole rewritten stack: entries that fail to become
 * DraftStackEntry objects are dropped, duplicate ids are re-assigned fresh
 * ids (so no rewrite can make ids collide), and the array is trimmed to
 * MAX_STACK_ENTRIES (oldest dropped).
 */
export function sanitizeStack(rawStack: readonly unknown[], now: number): DraftStackEntry[] {
  const seenIds = new Set<string>();
  const entries: DraftStackEntry[] = [];
  for (const raw of rawStack) {
    const entry = sanitizeEntry(raw, now);
    if (entry === null) continue;
    if (seenIds.has(entry.id)) entry.id = newDraftStackId(now + entries.length);
    seenIds.add(entry.id);
    entries.push(entry);
  }
  if (entries.length > MAX_STACK_ENTRIES) {
    // Keep the top MAX_STACK_ENTRIES: drop from the bottom.
    return entries.slice(entries.length - MAX_STACK_ENTRIES);
  }
  return entries;
}

/** Short relative label for a row's saved time ("3m ago"). */
export function relativeSavedAt(savedAt: number, now: number): string {
  const delta = Math.max(now - savedAt, 0);
  const formatter = new Intl.RelativeTimeFormat(undefined, { style: "narrow" });
  if (delta < 60_000) {
    return formatter.format(-Math.max(Math.round(delta / 1000), 1), "second");
  }
  if (delta < 3_600_000) {
    return formatter.format(-Math.round(delta / 60_000), "minute");
  }
  if (delta < 86_400_000) {
    return formatter.format(-Math.round(delta / 3_600_000), "hour");
  }
  return formatter.format(-Math.round(delta / 86_400_000), "day");
}
