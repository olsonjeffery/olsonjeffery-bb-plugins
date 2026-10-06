// bb-plugin-draft-stack — backend entry.
//
// The Draft Stack is a single persisted JSON array of composer drafts: text,
// @-mention pills, and already-uploaded attachments, in stack order (index 0
// is the bottom, the LAST element is the top). Pushes append; the Pop
// operation removes and returns the top; settings/popup/CLI mutate the same
// array over one RPC contract.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  draftIsEmpty,
  MAX_ATTACHMENTS_PER_DRAFT,
  MAX_MENTIONS_PER_DRAFT,
  MAX_STACK_ENTRIES,
  MAX_TEXT_LENGTH,
  newDraftStackId,
  sanitizeStack,
} from "./draft-stack.js";

// -- Wire schemas -----------------------------------------------------------

const AttachmentSchema = z.object({
  type: z.enum(["localFile", "localImage"]),
  name: z.string().min(1).max(500),
  path: z.string().min(1).max(2000),
  sizeBytes: z.number().int().min(0),
  mimeType: z.string().max(200).optional(),
});

// Mirrors the host's ComposerMention shape (bb-plugin-sdk-app.d.ts). Variant
// fields are spelled out per kind; strict() strips anything else so a
// mention pushed from one surface round-trips through replace() cleanly.
const MentionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      threadId: z.string().min(1),
      projectId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      projectId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("section"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      sectionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("path"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      path: z.string().min(1),
      source: z.enum(["thread-storage", "workspace"]),
      entryKind: z.enum(["directory", "file"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("command"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      trigger: z.enum(["$", "/"]),
      name: z.string().min(1),
      source: z.enum(["command", "skill"]),
      origin: z.enum(["builtin", "project", "user"]),
      argumentHint: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin"),
      from: z.number().int().min(0),
      to: z.number().int().min(1),
      label: z.string().max(500),
      pluginId: z.string().min(1),
      provider: z.string().min(1),
      id: z.string().min(1),
      icon: z.string().nullable().optional(),
    })
    .strict(),
]);

const EntrySchema = z.looseObject({
  id: z.string().min(1),
  text: z.string().max(MAX_TEXT_LENGTH),
  mentions: z.array(MentionSchema),
  attachments: z.array(AttachmentSchema),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  createdAt: z.number().int().positive(),
});

export type StackEntry = z.infer<typeof EntrySchema>;

const PushDraftSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH),
    mentions: z.array(MentionSchema).max(MAX_MENTIONS_PER_DRAFT).default([]),
    attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS_PER_DRAFT).default([]),
    projectId: z.string().min(1).nullable().default(null),
    threadId: z.string().min(1).nullable().default(null),
  })
  .strict();

// A rewrite may send anything per entry; sanitizeStack does the lenient
// per-entry coercion (keeping unknown fields, drafting sane ids) and drops
// what it cannot salvage, so one malformed entry never rejects the batch.
const RewriteStackSchema = z.object({ stack: z.array(z.unknown()).max(1000) });

export const rpcContract = defineRpcContract({
  /** The whole stack, array order (0 = bottom, last = top). */
  listStack: {
    input: z.null(),
    output: z.object({ stack: z.array(EntrySchema) }),
  },
  /** Appends a composer draft at the top of the stack. */
  pushDraft: {
    input: PushDraftSchema,
    output: z.object({ entry: EntrySchema, stack: z.array(EntrySchema) }),
  },
  /** Removes and returns the top entry. Null when the stack is empty. */
  popDraft: {
    input: z.null(),
    output: z.object({ entry: EntrySchema.nullable() }),
  },
  /** Removes and returns any entry by id (the popup's pick = pop semantics). */
  popEntry: {
    input: z.object({ entryId: z.string().min(1) }).strict(),
    output: z.object({ entry: EntrySchema.nullable() }),
  },
  /** Settings deletion: removes one entry without returning it. */
  removeEntry: {
    input: z.object({ entryId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  /** Settings drag/keyboard reorder: moves one entry to a target array index (0 = bottom). */
  moveEntry: {
    input: z
      .object({ entryId: z.string().min(1), toIndex: z.number().int().min(0) })
      .strict(),
    output: z.object({ stack: z.array(EntrySchema) }),
  },
  /** Empties the stack. */
  clearStack: {
    input: z.null(),
    output: z.object({ ok: z.boolean() }),
  },
  /** Arbitrary rewrite: the sanitized stack replaces what was stored. */
  rewriteStack: {
    input: RewriteStackSchema,
    output: z.object({ stack: z.array(EntrySchema) }),
  },
});

/** Realtime channel every surface refetches on. */
const CHANNEL = "draft-stack-changed";

export default async function plugin(bb: BbPluginApi) {
  // The stack lives as ONE row in the plugin database: a single JSON array,
  // serialized whole on every write. SQLite text storage means arbitrary
  // content (quotes, emoji, code, newlines) needs no escaping work from us —
  // JSON.stringify/parse is the whole story.
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS draft_stack (
       id    INTEGER PRIMARY KEY CHECK (id = 1),
       stack TEXT NOT NULL
     )`,
  ]);

  let stack: StackEntry[] = (function load(): StackEntry[] {
    try {
      const row = db.prepare("SELECT stack FROM draft_stack WHERE id = 1").get() as
        | { stack: string }
        | undefined;
      if (row === undefined) return [];
      return sanitizeStack(JSON.parse(row.stack) as unknown[], Date.now()) as StackEntry[];
    } catch (cause) {
      bb.log.warn(
        `stack read failed; starting empty: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return [];
    }
  })();

  function persist(): void {
    db.prepare(
      "INSERT INTO draft_stack (id, stack) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET stack = excluded.stack",
    ).run(JSON.stringify(stack));
  }

  function save(): void {
    persist();
    bb.realtime.publish(CHANNEL, { count: stack.length });
  }

  function indexOf(entryId: string): number {
    return stack.findIndex((entry) => entry.id === entryId);
  }

  bb.rpc.register(rpcContract, {
    listStack: () => ({ stack }),

    pushDraft: (draft) => {
      if (draftIsEmpty(draft)) {
        throw new Error("Nothing to push: the draft is empty");
      }
      const now = Date.now();
      const entry: StackEntry = {
        id: newDraftStackId(now),
        text: draft.text,
        mentions: draft.mentions,
        attachments: draft.attachments,
        projectId: draft.projectId,
        threadId: draft.threadId,
        createdAt: now,
      };
      stack.push(entry);
      if (stack.length > MAX_STACK_ENTRIES) {
        stack = stack.slice(stack.length - MAX_STACK_ENTRIES);
      }
      save();
      return { entry, stack };
    },

    popDraft: () => {
      const entry = stack.pop() ?? null;
      if (entry !== null) save();
      return { entry };
    },

    popEntry: ({ entryId }) => {
      const index = indexOf(entryId);
      if (index === -1) return { entry: null };
      const [entry] = stack.splice(index, 1);
      save();
      return { entry };
    },

    removeEntry: ({ entryId }) => {
      const index = indexOf(entryId);
      if (index === -1) return { ok: false };
      stack.splice(index, 1);
      save();
      return { ok: true };
    },

    moveEntry: ({ entryId, toIndex }) => {
      const fromIndex = indexOf(entryId);
      const clampedTo = Math.min(Math.max(toIndex, 0), stack.length - 1);
      if (fromIndex === -1 || clampedTo === fromIndex) return { stack };
      const [entry] = stack.splice(fromIndex, 1);
      stack.splice(clampedTo, 0, entry);
      save();
      return { stack };
    },

    clearStack: () => {
      if (stack.length > 0) {
        stack = [];
        save();
      }
      return { ok: true };
    },

    rewriteStack: ({ stack: rewritten }) => {
      stack = sanitizeStack(rewritten, Date.now()) as StackEntry[];
      // sanitizeStack backfills missing ids (newDraftStackId) and re-ids
      // collisions, so an arbitrary rewrite can never leave the stack with
      // duplicate or missing entry ids.
      save();
      return { stack };
    },
  });

  // The `bb draft-stack` CLI: agents (and shells) can inspect the stack
  // without the UI. Writes here run server-side and publish like any other.
  bb.cli.register({
    name: "draft-stack",
    summary: "Inspect and manage the Draft Stack plugin's stored drafts",
    commands: [
      { name: "list", summary: "List stack entries, top last", usage: "bb draft-stack list [--json]" },
      {
        name: "push",
        summary: "Push a text draft onto the stack (no attachments)",
        usage: 'bb draft-stack push <text> [--json]',
      },
      { name: "pop", summary: "Print and remove the top entry", usage: "bb draft-stack pop [--json]" },
      {
        name: "remove",
        summary: "Remove one entry by id",
        usage: "bb draft-stack remove <entry-id> [--json]",
      },
      { name: "clear", summary: "Empty the stack", usage: "bb draft-stack clear [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      const describe = (entry: StackEntry, index: number): string => {
        const scope = entry.threadId !== null ? `thread ${entry.threadId}` : entry.projectId !== null ? `project ${entry.projectId}` : "no scope";
        const extras = entry.attachments.length > 0 ? ` [+${entry.attachments.length} att]` : "";
        const preview = entry.text.replace(/\s+/g, " ").trim().slice(0, 80);
        return `#${index}  ${entry.id}  (${scope})  ${extras}  ${preview}`;
      };
      const entryId = args[0];
      switch (command) {
        case undefined:
        case "help":
        case "--help": {
          return {
            exitCode: 0,
            stdout: `Usage:\n  bb draft-stack list [--json]\n  bb draft-stack push <text> [--json]\n  bb draft-stack pop [--json]\n  bb draft-stack remove <entry-id> [--json]\n  bb draft-stack clear [--json]`,
          };
        }
        case "list": {
          if (stack.length === 0) return reply({ stack }, "The stack is empty.");
          return reply(
            { stack },
            stack.map((entry, index) => describe(entry, index + 1)).join("\n"),
          );
        }
        case "push": {
          const text = args.join(" ").trim();
          if (text === "") break;
          const entry: StackEntry = {
            id: newDraftStackId(Date.now()),
            text,
            mentions: [],
            attachments: [],
            projectId: null,
            threadId: null,
            createdAt: Date.now(),
          };
          stack.push(entry);
          save();
          return reply(
            { entry, total: stack.length },
            `Pushed #${stack.length}: ${entry.text.slice(0, 80)}`,
          );
        }
        case "pop": {
          const entry = stack.pop() ?? null;
          if (entry === null) return reply({ entry: null }, "The stack is empty.");
          save();
          return reply({ entry }, `${describe(entry, stack.length + 1)}\nPopped.`);
        }
        case "remove": {
          if (entryId === undefined || args.length !== 1) break;
          const index = indexOf(entryId);
          if (index === -1) {
            return { exitCode: 1, stderr: `No entry with id ${entryId}. Run "bb draft-stack list" to see ids.` };
          }
          stack.splice(index, 1);
          save();
          return reply({ ok: true }, `Removed ${entryId}.`);
        }
        case "clear": {
          const cleared = stack.length;
          stack = [];
          if (cleared > 0) save();
          return reply({ ok: true }, cleared === 0 ? "The stack is empty." : `Cleared ${cleared} entries.`);
        }
      }
      return { exitCode: 1, stderr: `Usage: bb draft-stack <list|push|pop|remove|clear> [--json]` };
    },
  });

  bb.onDispose(() => {
    bb.log.info(`disposed with ${stack.length} stacked drafts`);
  });
}
