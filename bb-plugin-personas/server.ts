// bb-plugin-personas — backend entry.
//
// A "persona" is a name, an emoji, a pool of prompts, and a model. Chatting
// with one spawns an ordinary BB thread; bb.agents.contributeInstructions then
// injects that persona's joined prompt pool into every turn of that thread.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  clampDefaultUserMessage,
  clampPromptText,
  decodeDocPromptRef,
  decodeNotePromptRef,
  defaultThreadTagLabel,
  displayName,
  docPromptRefKey,
  DOC_UNAVAILABLE_TEXT,
  draftBlockers,
  encodeDocPromptRef,
  encodeNotePromptRef,
  docsPromptBody,
  MAX_DEFAULT_USER_MESSAGE,
  MAX_NAME,
  MAX_PROMPT_TEXT,
  MENTION_PROVIDER_ID,
  newPersonaId,
  newPromptId,
  NOTE_UNAVAILABLE_TEXT,
  PERSONA_COLORS,
  personaIdFromDispatchBlocks,
  personaToExport,
  pillLabel,
  pickEmoji,
  resolvePromptTexts,
  renderPersonaInstructions,
  rowToPersona,
  rowToPrompt,
  sortChats,
  threadTagColorHex,
  uniqueImportName,
  type ExportedPersona,
  type Persona,
  type PersonaPrompt,
  type PersonaPromptRow,
  type PersonaRow,
} from "./personas.js";
import { pluginHealth, selfInstallLabel } from "./plugin-health.js";
import {
  DOCS_PLUGIN_ID,
  FLOATING_NOTES_PLUGIN_ID,
  isDocsAvailable,
  isFloatingNotesAvailable,
  THREAD_TAGS_PLUGIN_ID,
  THREAD_TAGS_PLUGIN_SOURCE,
  isThreadTagsAvailable,
} from "./plugin-health.js";

const ReasoningLevel = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);

const PersonaColor = z.enum(PERSONA_COLORS);

const PersonaPromptSchema = z.object({
  id: z.string(),
  personaId: z.string(),
  // "text" carries its own prose; "note" points at a Floating Note; "doc"
  // points at a file in a Docs vault.
  type: z.enum(["text", "note", "doc"]),
  // For "text" prompts: the prose. For live prompts: the source's current
  // content, resolved server-side so the wire never leaks the stored JSON
  // reference.
  text: z.string(),
  // Present only on "note" prompts: the durable Floating Note id this entry
  // points at.
  noteId: z.string().optional(),
  // Present only on "doc" prompts: the Docs vault id and vault-relative path
  // this entry points at.
  docVaultId: z.string().optional(),
  docPath: z.string().optional(),
  position: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  // The chosen avatar color; null = the stable hash-derived tint.
  color: PersonaColor.nullable(),
  // The Thread Tags plugin tag this persona rides under; null = none
  // provisioned yet (the server provisions from the emoji/title lazily).
  threadTagId: z.string().nullable(),
  prompts: z.array(PersonaPromptSchema),
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: ReasoningLevel.nullable(),
  projectId: z.string().nullable(),
  // Optional Default User Message: injected into the composer's text area
  // when the persona's composer view opens. "" = none provided.
  defaultUserMessage: z.string(),
  status: z.enum(["draft", "published"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

// Lenient on purpose: the editor autosaves a half-typed persona on every
// keystroke, so nothing here can require a value. Validation moves to
// publish time (draftBlockers), where an incomplete persona actually matters.
const PersonaPatchSchema = z
  .object({
    name: z.string().max(MAX_NAME),
    emoji: z.string().min(1).max(16),
    color: PersonaColor.nullable(),
    providerId: z.string(),
    model: z.string(),
    reasoningLevel: ReasoningLevel.nullable(),
    projectId: z.string().nullable(),
    defaultUserMessage: z.string().max(MAX_DEFAULT_USER_MESSAGE),
  })
  .partial()
  .strict();

const ChatSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  updatedAt: z.number().int(),
  // Mirror threadListResponseSchema's own field names (bb-plugin-sdk.d.ts)
  // exactly, both nullable: an unpinned/unarchived thread has null, not 0 or
  // false, so the frontend can tell "never pinned" from "pinned at epoch 0".
  pinnedAt: z.number().int().nullable(),
  archivedAt: z.number().int().nullable(),
});

// One Plugin health box row (plugin-health.ts's ToolHealth, at the RPC
// boundary where the wire shape has to be spelled out in zod anyway).
const ToolHealthSchema = z.object({
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  enabled: z.boolean(),
  status: z.string().nullable(),
  version: z.string().nullable(),
  installUrl: z.string().nullable(),
  available: z.boolean(),
});

// What we read out of Floating Notes' listNotes. The real output carries many
// more fields per note (kind, color, pin state, …); only the fields a prompt
// attachment needs are declared, and the rest are stripped by validation.
const FloatingNotesListOutput = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      updatedAt: z.number(),
    }),
  ),
});

/** One attachable Floating Note, as the picker modal sees it. */
const FloatingNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  updatedAt: z.number(),
});

// Active Floating Notes for prompt re-linking at import time: the prompt
// shape carries the export snapshot plus the durable note id, and the import
// checks this list to see which of them still exist here.
const ExportedPromptSchema = z.object({
  type: z.enum(["text", "note", "doc"]),
  text: z.string(),
  noteId: z.string().optional(),
  vaultId: z.string().optional(),
  path: z.string().optional(),
});

// -- Docs (BB's built-in Docs plugin, id "simple-notes") wire shapes -------
//
// Field mirrors of the docs plugin's own zod contracts, read the same way the
// Floating Notes block above reads Floating Notes': only the fields this
// plugin consumes are declared (plain z.object strips the rest rather than
// becoming a cross-plugin contract).

/** One Docs vault, as the picker's vault list and per-vault grouping see it. */
const DocsVaultSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

/** One attachable Docs markdown document, as the picker modal sees it. */
const DocsNoteSummarySchema = z.object({
  path: z.string(),
  title: z.string(),
  preview: z.string(),
  modifiedAtMs: z.number(),
});

// The docs plugin's listNotes reply for one vault. The real payload carries
// hosts, entries, entryOrder, and truncation state; a prompt attachment needs
// only the vault list and the markdown note summaries.
const DocsListNotesOutput = z.object({
  vaults: z.array(DocsVaultSchema),
  notes: z.array(DocsNoteSummarySchema),
  // The docs plugin reports per-vault read failures inline (error non-null)
  // rather than throwing; the picker surfaces that as an empty vault.
  error: z.string().nullable(),
});

// The docs plugin's readNote reply: any vault file's bytes, utf8 for text.
// mimeType/sizeBytes/sha256/modifiedAtMs are stripped — a prompt needs the
// text and the knowledge of whether it was text at all.
const DocsReadNoteOutput = z.object({
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
});

//
// -- Thread Tags wire shapes ----------------------------------------------------------
//
// Field mirrors of bb-plugin-thread-tags' own zod contracts, at v0.1.0 — the
// same approach the Floating Notes block above takes: only the fields this
// plugin consumes are declared, the rest of the other plugin's payload is
// stripped by validation rather than becoming a cross-plugin contract.
const ThreadTagSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});

/** One Thread Tags tag, as this plugin reads it across the RPC boundary. */
type PersonaThreadTag = z.output<typeof ThreadTagSchema>;

// thread-tags' state_get, stripped of the assignments map this plugin never
// reads (it reads the tag list and its own persona-side threadTagId instead).
const ThreadTagsStateOutput = z.object({
  tags: z.array(ThreadTagSchema),
  assignments: z.record(z.string(), z.string()),
});

// thread-tags' thread_set_tag reply.
const ThreadTagsSetOutput = z.object({
  tagId: z.string().nullable(),
});

// One persona of an export file, validated at the boundary. The field set
// mirrors PersonaSchema's meaningful fields with ids, timestamps, and chat
// mappings deliberately absent — the exporter never wrote them and the
// importer assigns fresh ones.
const ExportedPersonaSchema = z.object({
  format: z.string().optional(),
  name: z.string().max(MAX_NAME),
  emoji: z.string().min(1).max(16),
  color: PersonaColor.nullable(),
  status: z.enum(["draft", "published"]),
  providerId: z.string().max(200),
  model: z.string().max(200),
  reasoningLevel: ReasoningLevel.nullable(),
  projectId: z.string().max(200).nullable(),
  defaultUserMessage: z.string().max(MAX_DEFAULT_USER_MESSAGE),
  prompts: z.array(ExportedPromptSchema),
});

export const rpcContract = defineRpcContract({
  listPersonas: {
    input: z.null(),
    output: z.object({ personas: z.array(PersonaSchema) }),
  },
  getPersona: {
    input: z.object({ personaId: z.string() }).strict(),
    output: z.object({ persona: PersonaSchema.nullable() }),
  },
  // Writes an empty draft row immediately; the editor seeds and autosaves
  // provider/model/name itself via savePersona.
  createPersona: {
    input: z.null(),
    output: z.object({ personaId: z.string() }),
  },
  savePersona: {
    input: z.object({ personaId: z.string(), patch: PersonaPatchSchema }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  // Adds one prompt to a persona's pool: typed prose (type "text"), a live
  // Floating Note reference (type "note", by durable note id), or a live
  // Docs vault file reference (type "doc", by vault id + vault-relative
  // path). Each live entry is read at render time, so later edits to the
  // source flow through. Duplicates are allowed; the user curates the pool.
  addPersonaPrompt: {
    input: z.discriminatedUnion("type", [
      z
        .object({
          personaId: z.string(),
          type: z.literal("text"),
          text: z.string().min(1).max(MAX_PROMPT_TEXT),
        })
        .strict(),
      z
        .object({
          personaId: z.string(),
          type: z.literal("note"),
          noteId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          personaId: z.string(),
          type: z.literal("doc"),
          // Vault ids and paths come straight from the docs plugin's own
          // listing; the bounds here only stop nonsense at the boundary.
          vaultId: z.string().min(1).max(200),
          path: z.string().min(1).max(400),
        })
        .strict(),
    ]),
    output: z.object({ prompt: PersonaPromptSchema }),
  },
  // Rewrites one TEXT prompt's text. Note and doc prompts aren't editable —
  // remove the entry and attach the source again instead.
  updatePersonaPrompt: {
    input: z
      .object({
        personaId: z.string(),
        promptId: z.string(),
        text: z.string().min(1).max(MAX_PROMPT_TEXT),
      })
      .strict(),
    output: z.object({ prompt: PersonaPromptSchema }),
  },
  removePersonaPrompt: {
    input: z
      .object({ personaId: z.string(), promptId: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
  publishPersona: {
    input: z.object({ personaId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  deletePersona: {
    input: z.object({ personaId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  listChats: {
    input: z.object({ personaId: z.string() }).strict(),
    output: z.object({
      chats: z.array(ChatSchema),
      archivedChats: z.array(ChatSchema),
    }),
  },
  // The rail's single round trip: every persona plus its chats in one call, so
  // the panel never has to fan out per-persona RPCs on load.
  listRail: {
    input: z.null(),
    output: z.object({
      personas: z.array(
        PersonaSchema.extend({
          chats: z.array(
            z.object({
              threadId: z.string(),
              title: z.string().nullable(),
              status: z.string(),
              updatedAt: z.number().int(),
            }),
          ),
          lastActivityAt: z.number().int(),
        }),
      ),
    }),
  },
  // The Thread Info chip's lookup: the persona one thread belongs to (the
  // persona-pill mapping below), or null for an ordinary thread.
  getPersonaForThread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      persona: z
        .object({
          id: z.string(),
          name: z.string(),
          emoji: z.string(),
          color: PersonaColor.nullable(),
        })
        .nullable(),
    }),
  },
  // Pin/rename/archive/delete all come from the host's own
  // experimental_useThreadActions() entries on the frontend; unarchive is
  // the one action those rows don't route through (archived rows render
  // their own menu), so it's the only mutation this plugin provides itself.
  unarchiveChat: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  listOptions: {
    input: z.null(),
    output: z.object({
      providers: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          available: z.boolean(),
        }),
      ),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      personalProjectId: z.string().nullable(),
    }),
  },
  listModels: {
    input: z.object({ providerId: z.string() }).strict(),
    output: z.object({
      models: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          description: z.string(),
          isDefault: z.boolean(),
          defaultReasoningEffort: ReasoningLevel,
          reasoningEfforts: z.array(ReasoningLevel),
        }),
      ),
    }),
  },
  getPluginHealth: {
    input: z.null(),
    output: z.object({
      floatingNotesAvailable: z.boolean(),
      threadTagsAvailable: z.boolean(),
      docsAvailable: z.boolean(),
      tools: z.array(ToolHealthSchema),
      self: z.object({
        version: z.string().nullable(),
        source: z.string().nullable(),
        managed: z.boolean(),
        // Human-readable: "Local path install — /home/…" or the raw managed
        // source string. Null when the install source couldn't be read.
        sourceLabel: z.string().nullable(),
      }),
    }),
  },
  // Every active Floating Note, for the editor's "Add Floating Note" picker.
  // Throws when Floating Notes isn't installed-and-enabled, so the gate is
  // the same one-plugin rule the health flag uses.
  listFloatingNotes: {
    input: z.null(),
    output: z.object({ notes: z.array(FloatingNoteSchema) }),
  },
  // Every Docs vault with its markdown documents, for the editor's "Add Docs
  // document" picker. Throws when the built-in Docs plugin isn't
  // installed-and-enabled; a vault that fails to read lists as empty rather
  // than sinking the picker.
  listDocsSources: {
    input: z.null(),
    output: z.object({
      vaults: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          notes: z.array(DocsNoteSummarySchema),
        }),
      ),
    }),
  },
  // -- Thread Tags (bb-plugin-thread-tags) ----------------------------------

  // The Thread Tags state this persona rides: the plugin's availability, the
  // persona's current tag id (a missing/invalid one becomes a fresh default
  // tag built from the persona's identity — the lazy provision point the
  // editor and the dispatch hook share), and all configured tags for the
  // picker. Tags [] and availability false degrade quietly.
  getThreadTagState: {
    input: z.object({ personaId: z.string() }).strict(),
    output: z.object({
      threadTagsAvailable: z.boolean(),
      threadTagId: z.string().nullable(),
      tags: z.array(ThreadTagSchema),
    }),
  },
  // Re-points the persona at one configured tag (the settings picker's
  // write path). Validated against the live tag set while the plugin is
  // available — like the Floating Notes RPCs, the gate is the same
  // one-plugin rule the health flag uses.
  setPersonaThreadTag: {
    input: z
      .object({ personaId: z.string(), threadTagId: z.string().min(1) })
      .strict(),
    output: z.object({ threadTagId: z.string().nullable() }),
  },
  // The one-click install behind the settings page's Thread Tags row:
  // badges bb's own installer with the same plugin source the marketplace
  // install resolves, then reports what the fresh install produced. Errors
  // (offline network, bad source string) propagate to the caller's toast.
  installThreadTags: {
    input: z.null(),
    output: z.object({
      ok: z.boolean(),
      pluginId: z.string().nullable(),
    }),
  },

  // -- Export / import (personas-v1) ----------------------------------------

  // Every persona as one export array, one object per persona, drafts
  // included. Note prompts resolve against fresh note bodies so the file is
  // self-contained: each carries its note's CURRENT body (verbatim) plus the
  // durable noteId for optional re-linking at import.
  exportPersonas: {
    input: z.null(),
    output: z.object({
      personas: z.array(
        z.object({
          format: z.string().optional(),
          name: z.string(),
          emoji: z.string(),
          color: PersonaColor.nullable(),
          status: z.enum(["draft", "published"]),
          providerId: z.string(),
          model: z.string(),
          reasoningLevel: ReasoningLevel.nullable(),
          projectId: z.string().nullable(),
          defaultUserMessage: z.string(),
          prompts: z.array(ExportedPromptSchema),
        }),
      ),
    }),
  },
  // Imports an export array additively: fresh ids, pool order preserved,
  // name collisions resolved as "Name (NEW-IMPORT)", "(NEW-IMPORT-2)", …
  // One invalid persona skips only itself — the batch reports what happened
  // rather than failing whole. Note prompts re-attach to the live note when
  // that note id exists in THIS bb (Floating Notes present), and otherwise
  // degrade to the verbatim text prompt the file already carries.
  importPersonas: {
    // Deliberately unknown entries: validation happens per persona inside
    // the handler, so one malformed entry skips only itself instead of
    // rejecting the whole file at the boundary.
    input: z.object({ personas: z.array(z.unknown()) }).strict(),
    output: z.object({
      imported: z.number().int(),
      skipped: z.number().int(),
      errors: z.array(
        z.object({ index: z.number().int(), error: z.string() }),
      ),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS personas (
       id              TEXT PRIMARY KEY,
       name            TEXT NOT NULL,
       emoji           TEXT NOT NULL,
       instructions    TEXT NOT NULL,
       provider_id     TEXT NOT NULL,
       model           TEXT NOT NULL,
       reasoning_level TEXT,
       project_id      TEXT,
       created_at      INTEGER NOT NULL,
       updated_at      INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS persona_threads (
       thread_id  TEXT PRIMARY KEY,
       persona_id TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS persona_threads_persona_id ON persona_threads(persona_id)`,
    // The DEFAULT backfills every existing row as published, so there's no
    // separate backfill statement or code path.
    `ALTER TABLE personas ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`,
    `CREATE TABLE IF NOT EXISTS persona_prompts (
       id         TEXT PRIMARY KEY,
       persona_id TEXT NOT NULL,
       type       TEXT NOT NULL DEFAULT 'text',
       text       TEXT NOT NULL,
       position   INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS persona_prompts_persona_id ON persona_prompts(persona_id)`,
    // NULL = auto: the stable hash-derived avatar tint. Existing rows keep
    // looking exactly as they did before the column existed.
    `ALTER TABLE personas ADD COLUMN color TEXT`,
    // The persona's optional Default User Message. '' = none provided, so
    // the DEFAULT backfills every existing row as nothing-injected.
    `ALTER TABLE personas ADD COLUMN default_user_message TEXT NOT NULL DEFAULT ''`,
    // The Thread Tags plugin tag this persona rides under. NULL = none
    // provisioned yet; provisioning happens lazily against the live tag set.
    `ALTER TABLE personas ADD COLUMN thread_tag_id TEXT`,
  ]);

  // One-time carry-over from the pre-rename schema (tables `bots` and
  // `bot_threads`, written by versions before this plugin was renamed to
  // personas). Checked on every start so it's idempotent; the legacy tables
  // are dropped once their rows have been copied across. Old `bot_*` id
  // prefixes are left untouched — ids are opaque strings everywhere else.
  const legacyTables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  if (legacyTables.has("bots")) {
    // Rows written before the status column existed still read as published.
    const legacyHasStatus = (
      db.prepare("PRAGMA table_info(bots)").all() as { name: string }[]
    ).some((column) => column.name === "status");
    db.prepare(
      `INSERT INTO personas (id, name, emoji, instructions, provider_id, model,
                             reasoning_level, project_id, status, created_at, updated_at)
       SELECT id, name, emoji, instructions, provider_id, model,
              reasoning_level, project_id, ${legacyHasStatus ? "status" : "'published'"}, created_at, updated_at
         FROM bots`,
    ).run();
    db.prepare("DROP TABLE bots").run();
  }
  if (legacyTables.has("bot_threads")) {
    db.prepare(
      `INSERT INTO persona_threads (thread_id, persona_id, created_at)
       SELECT thread_id, bot_id, created_at FROM bot_threads`,
    ).run();
    db.prepare("DROP TABLE bot_threads").run();
  }

  // One-time carry-over from the pre-pool schema: each persona's single
  // `instructions` column becomes its first text prompt. Runs after the
  // bots carry-over so legacy bot instructions arrive too. Idempotent — a
  // persona that already owns any prompt row is skipped — and it leaves the
  // old column in place (vestigial, never written again) because SQLite
  // makes dropping columns more trouble than ignoring one.
  const legacyInstructionRows = db
    .prepare(
      `SELECT id, instructions, updated_at FROM personas
        WHERE instructions != ''
          AND id NOT IN (SELECT persona_id FROM persona_prompts)`,
    )
    .all() as { id: string; instructions: string; updated_at: number }[];
  for (const row of legacyInstructionRows) {
    db.prepare(
      `INSERT INTO persona_prompts (id, persona_id, type, text, position,
                                   created_at, updated_at)
       VALUES (?, ?, 'text', ?, 0, ?, ?)`,
    ).run(newPromptId(), row.id, row.instructions, row.updated_at, row.updated_at);
  }

  // contributeInstructions is synchronous and sits on the thread-start path,
  // so SQLite is the durable store and these maps are the read path. A BB
  // plugin is one in-process module, so caching here is safe.
  // personaId -> its tag provisioning, while one is in flight. Two threads
  // starting in the same instant must not both find the persona tagless and
  // create two default tags; whoever arrives second awaits the same promise.
  const threadTagProvisioningByPersonaId = new Map<
    string,
    Promise<PersonaThreadTag | null>
  >();

  const personasById = new Map<string, Persona>();
  const personaIdByThreadId = new Map<string, string>();
  // personaId -> that persona's prompt pool. The array stored here is the
  // same array the Persona object holds (rowToPersona assigns by reference),
  // so prompt RPCs mutate one list and every reader sees the change.
  const promptsByPersonaId = new Map<string, PersonaPrompt[]>();

  /** The persona's live pool, created on first touch so RPCs can mutate it. */
  function promptsFor(personaId: string): PersonaPrompt[] {
    let prompts = promptsByPersonaId.get(personaId);
    if (prompts === undefined) {
      prompts = [];
      promptsByPersonaId.set(personaId, prompts);
    }
    return prompts;
  }

  for (const row of db
    .prepare("SELECT * FROM persona_prompts ORDER BY persona_id, position, created_at")
    .all() as PersonaPromptRow[]) {
    promptsFor(row.persona_id).push(rowToPrompt(row));
  }
  for (const row of db.prepare("SELECT * FROM personas").all() as PersonaRow[]) {
    personasById.set(row.id, rowToPersona(row, promptsFor(row.id)));
  }
  for (const row of db
    .prepare("SELECT thread_id, persona_id FROM persona_threads")
    .all() as { thread_id: string; persona_id: string }[]) {
    personaIdByThreadId.set(row.thread_id, row.persona_id);
  }
  bb.log.info(
    `loaded ${personasById.size} personas across ${personaIdByThreadId.size} threads`,
  );

  // Live Floating Note bodies by durable note id, and live Docs file
  // contents by vault id + path — the read paths the live prompt types
  // resolve against. contributeInstructions is synchronous, so it can only
  // read these caches; the refresh paths below keep them fresh.
  const noteBodiesById = new Map<string, string>();
  const docBodiesByRef = new Map<string, string>();

  /** True when any persona's pool holds a note prompt. */
  function anyNotePrompts(): boolean {
    for (const prompts of promptsByPersonaId.values()) {
      if (prompts.some((prompt) => prompt.type === "note")) return true;
    }
    return false;
  }

  /** True when any persona's pool holds a doc prompt. */
  function anyDocPrompts(): boolean {
    for (const prompts of promptsByPersonaId.values()) {
      if (prompts.some((prompt) => prompt.type === "doc")) return true;
    }
    return false;
  }

  /** Every doc reference any pool currently holds, without duplicates. */
  function referencedDocRefs(): { vaultId: string; path: string }[] {
    const refs = new Map<string, { vaultId: string; path: string }>();
    for (const prompts of promptsByPersonaId.values()) {
      for (const prompt of prompts) {
        if (prompt.type !== "doc") continue;
        const ref = decodeDocPromptRef(prompt.text);
        if (ref === null) continue;
        refs.set(docPromptRefKey(ref.vaultId, ref.path), {
          vaultId: ref.vaultId,
          path: ref.path,
        });
      }
    }
    return [...refs.values()];
  }

  /**
   * Re-reads the active notes from Floating Notes into the cache. A no-op
   * while no persona holds a note prompt or Floating Notes is unavailable; a
   * failure logs and leaves the last-known bodies in place, so a blip in the
   * other plugin never blanks a persona's instructions.
   */
  async function refreshNoteBodies(): Promise<void> {
    if (!anyNotePrompts()) return;
    try {
      const { plugins } = await bb.sdk.plugins.list();
      if (!isFloatingNotesAvailable(plugins)) return;
      const listed = await bb.sdk.plugins.callRpc({
        pluginId: FLOATING_NOTES_PLUGIN_ID,
        method: "listNotes",
        input: { view: "active", limit: 500 },
        outputSchema: FloatingNotesListOutput,
      });
      for (const note of listed.notes) noteBodiesById.set(note.id, note.body);
    } catch (cause) {
      bb.log.warn(
        `note refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  /**
   * Re-reads every referenced Docs file into the cache. A no-op while no
   * persona holds a doc prompt or Docs is unavailable; one file failing to
   * read only drops that file from the cache (its prompt shows the
   * unavailable marker) and never blanks the rest. Binary files are skipped:
   * their bytes are not prompt text.
   */
  async function refreshDocBodies(): Promise<void> {
    if (!anyDocPrompts()) return;
    try {
      const { plugins } = await bb.sdk.plugins.list();
      if (!isDocsAvailable(plugins)) return;
      await Promise.all(
        referencedDocRefs().map(async (ref) => {
          try {
            const file = await bb.sdk.plugins.callRpc({
              pluginId: DOCS_PLUGIN_ID,
              method: "readNote",
              input: { vaultId: ref.vaultId, path: ref.path },
              outputSchema: DocsReadNoteOutput,
            });
            if (file.contentEncoding === "utf8") {
              // The cache holds the prompt body: raw content minus any
              // leading front matter block, which is file metadata, not
              // persona text.
              docBodiesByRef.set(
                docPromptRefKey(ref.vaultId, ref.path),
                docsPromptBody(file.content),
              );
            } else {
              docBodiesByRef.delete(docPromptRefKey(ref.vaultId, ref.path));
            }
          } catch {
            // One unreadable file must not sink the others; the cache keeps
            // its last-known body for it.
          }
        }),
      );
    } catch (cause) {
      bb.log.warn(
        `doc refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  /**
   * One prompt in wire shape. A live prompt never leaks its stored JSON
   * reference: `text` is its source's CURRENT content (or the unavailable
   * marker), and the durable link rides in its own fields the UI renders
   * from (`noteId`, or `docVaultId`+`docPath`).
   */
  function toWirePrompt(prompt: PersonaPrompt) {
    if (prompt.type === "text") return { ...prompt };
    if (prompt.type === "doc") {
      // rowToPrompt guarantees a "doc" row decodes.
      const ref = decodeDocPromptRef(prompt.text)!;
      return {
        ...prompt,
        text:
          docBodiesByRef.get(docPromptRefKey(ref.vaultId, ref.path)) ??
          DOC_UNAVAILABLE_TEXT,
        docVaultId: ref.vaultId,
        docPath: ref.path,
      };
    }
    // rowToPrompt guarantees a "note" row decodes.
    const ref = decodeNotePromptRef(prompt.text)!;
    return {
      ...prompt,
      text: noteBodiesById.get(ref.noteId) ?? NOTE_UNAVAILABLE_TEXT,
      noteId: ref.noteId,
    };
  }

  function toWirePersona(persona: Persona) {
    return { ...persona, prompts: persona.prompts.map(toWirePrompt) };
  }

  /** Persist the persona's tag pointer without touching activity ordering. */
  function storeThreadTagId(persona: Persona, threadTagId: string | null): void {
    persona.threadTagId = threadTagId;
    db.prepare("UPDATE personas SET thread_tag_id = ? WHERE id = ?").run(
      threadTagId,
      persona.id,
    );
  }

  async function listThreadTagsOrEmpty(): Promise<PersonaThreadTag[]> {
    try {
      const listed = await bb.sdk.plugins.callRpc({
        pluginId: THREAD_TAGS_PLUGIN_ID,
        method: "state_get",
        input: null,
        outputSchema: ThreadTagsStateOutput,
      });
      return [...listed.tags];
    } catch (cause) {
      bb.log.warn(
        `thread tags read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return [];
    }
  }

  /**
   * The one Thread Tags tag this persona rides under, provisioned on first
   * need. null means Thread Tags isn't usable right now — no state changed.
   *
   * A persona whose stored id still names a configured tag ships as-is; a
   * tagless (or orphaned-id) persona gets a default tag built from its own
   * identity — the emoji, else the title — tinted like its avatar. The
   * pointer lands in the row without bumping updated_at: plumbing, like the
   * note-body cache, not activity a rail would re-sort on.
   */
  async function ensurePersonaThreadTag(
    persona: Persona,
  ): Promise<PersonaThreadTag | null> {
    const inFlight = threadTagProvisioningByPersonaId.get(persona.id);
    if (inFlight !== undefined) return inFlight;
    const run = (async (): Promise<PersonaThreadTag | null> => {
      const { plugins } = await bb.sdk.plugins.list();
      if (!isThreadTagsAvailable(plugins)) return null;
      const tags = await listThreadTagsOrEmpty();
      const known =
        persona.threadTagId !== null
          ? tags.find((tag) => tag.id === persona.threadTagId)
          : undefined;
      if (known !== undefined) return known;
      const label = defaultThreadTagLabel(persona.emoji, displayName(persona));
      const created = await bb.sdk.plugins.callRpc({
        pluginId: THREAD_TAGS_PLUGIN_ID,
        method: "tag_create",
        input: { label, color: threadTagColorHex(persona.id, persona.color) },
        outputSchema: z.object({
          id: z.string(),
          label: z.string(),
          color: z.string(),
        }),
      });
      storeThreadTagId(persona, created.id);
      bb.log.info(`provisioned thread tag ${created.id} for persona ${persona.id}`);
      return created;
    })();
    threadTagProvisioningByPersonaId.set(persona.id, run);
    try {
      return await run;
    } finally {
      threadTagProvisioningByPersonaId.delete(persona.id);
    }
  }

  /**
   * Applies the persona's tag to one freshly-bound thread — the tag side of
   * the pill dispatch. Fire-and-forget (the hook stays synchronous) and
   * never acts when Thread Tags is missing: a no-plugin BB just shows an
   * untagged thread, exactly as it did before this integration.
   */
  function applyPersonaThreadTag(threadId: string, personaId: string): void {
    void (async () => {
      try {
        const persona = personasById.get(personaId);
        if (persona === undefined || persona.status === "draft") return;
        const tag = await ensurePersonaThreadTag(persona);
        if (tag === null) return;
        await bb.sdk.plugins.callRpc({
          pluginId: THREAD_TAGS_PLUGIN_ID,
          method: "thread_set_tag",
          input: { threadId, tagId: tag.id },
          outputSchema: ThreadTagsSetOutput,
        });
        bb.log.info(
          `tagged thread ${threadId} with persona ${personaId}'s tag ${tag.id}`,
        );
      } catch (cause) {
        bb.log.warn(
          `thread tag application failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    })();
  }

  // The whole point of the plugin. Returning null for unmapped threads is
  // load-bearing: without it every thread in BB would inherit a persona.
  bb.agents.contributeInstructions(({ threadId }) => {
    const personaId = personaIdByThreadId.get(threadId);
    if (personaId === undefined) return null;
    const persona = personasById.get(personaId);
    if (persona === undefined) return null;
    // Live prompts contribute their source's CURRENT content, read from the
    // caches the refresh paths keep warm.
    return renderPersonaInstructions({
      ...persona,
      prompts: resolvePromptTexts(persona.prompts, noteBodiesById, docBodiesByRef),
    });
  });

  // -- Persona pills: how a New Thread composer send binds its thread -------
  //
  // The persona inline action on a new-thread composer inserts ONE @-mention
  // pill owned by the "personas" provider below. The pill IS the persona
  // selection: it survives reloads, the user can delete it to disarm, and it
  // travels with the submitted message. Two server pieces read it:
  //
  // 1. resolve() runs per message at send time and returns a short identity
  //    line the agent sees. The heavy lifting stays with
  //    contributeInstructions — the pool is injected per TURN for the mapped
  //    thread, never per message, so a resolve() that echoed the pool would
  //    double it.
  // 2. The message.dispatch hook below maps the NEW thread to the polled
  //    persona exactly once, on its first dispatch. From then on the thread
  //    is an ordinary persona chat: every turn gets the pool injected.

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER_ID,
    label: "Personas",
    // The user can pick a persona the ordinary @-menu way too; the picker
    // popup that inserts the pill is a faster path for the same pill.
    search({ query }) {
      const needle = query.toLowerCase();
      return [...personasById.values()]
        .filter(
          (persona) =>
            persona.status === "published" &&
            displayName(persona).toLowerCase().includes(needle),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((persona) => ({
          id: persona.id,
          title: displayName(persona),
          subtitle: [persona.providerId, persona.model]
            .filter((part) => part !== "")
            .join(" · ") || undefined,
        }));
    },
    // Never throws: throwing BLOCKS the send. A persona deleted after the
    // pill was placed resolves to an apologetic one-liner instead.
    resolve(itemId) {
      const persona = personasById.get(itemId);
      if (persona === undefined) {
        return { context: `The persona (id ${itemId}) no longer exists.` };
      }
      const label = displayName(persona);
      return {
        context:
          "This message carries a Persona pill. " +
          `The thread belongs to persona "${label}"; its standing instructions ` +
          "are contributed on every turn by the Personas plugin, so do not ask the user to repeat them.",
      };
    },
  });

  // THE pill-to-thread binding. Runs on every dispatch attempt; the mapping
  // is written once per thread and every later pass finds it already there.
  // Fail-closed: the handler stays synchronous (an in-memory map write), so
  // the 10-second decision box is never at risk.
  bb.experimental_hooks.on("message.dispatch", (context) => {
    if (context.attempt !== "start-turn") return { action: "proceed" };
    if (personaIdByThreadId.has(context.thread.id)) {
      return { action: "proceed" };
    }
    const personaId = personaIdFromDispatchBlocks(
      context.input.blocks,
      bb.pluginId,
    );
    if (personaId === undefined) return { action: "proceed" };
    const persona = personasById.get(personaId);
    // Drafts can't chat, and a deleted persona maps to nothing.
    if (persona === undefined || persona.status === "draft") {
      return { action: "proceed" };
    }
    db.prepare(
      "INSERT INTO persona_threads (thread_id, persona_id, created_at) VALUES (?, ?, ?)",
    ).run(context.thread.id, persona.id, Date.now());
    personaIdByThreadId.set(context.thread.id, persona.id);
    bb.log.info(
      `bound thread ${context.thread.id} to persona ${persona.id} via mention pill`,
    );
    // The Thread Tags side of the binding: a fresh thread gets its persona's
    // tag in the sidebar. Fire-and-forget — the hook must stay synchronous,
    // so provisioning and the cross-plugin set happen just after the map
    // write (a no-op entirely when Thread Tags isn't available).
    applyPersonaThreadTag(context.thread.id, persona.id);
    // The rail learns the new chat on the next refresh; the same channel the
    // start/unarchive/delete paths ping.
    announce();
    return { action: "proceed" };
  });

  function readPersona(personaId: string): Persona {
    const persona = personasById.get(personaId);
    if (persona === undefined) throw new Error(`Unknown persona: ${personaId}`);
    return persona;
  }

  /** Pool writes count as persona activity: bump updated_at in memory and on disk. */
  function touchPersona(persona: Persona, now: number): void {
    persona.updatedAt = now;
    db.prepare("UPDATE personas SET updated_at = ? WHERE id = ?").run(
      now,
      persona.id,
    );
  }

  function announce() {
    bb.realtime.publish("personas", { changedAt: Date.now() });
  }

  // The prompt-source RPCs gate on the same one-plugin rule the health flag
  // uses, read fresh per call: an install, enable, disable, or remove must be
  // reflected on the very next attempt.
  async function assertFloatingNotesAvailable(): Promise<void> {
    const { plugins } = await bb.sdk.plugins.list();
    if (!isFloatingNotesAvailable(plugins)) {
      throw new Error("Floating Notes is not installed and enabled");
    }
  }

  async function assertDocsAvailable(): Promise<void> {
    const { plugins } = await bb.sdk.plugins.list();
    if (!isDocsAvailable(plugins)) {
      throw new Error("Docs is not installed and enabled");
    }
  }

  bb.rpc.register(rpcContract, {
    listPersonas: () => ({
      personas: [...personasById.values()]
        .map(toWirePersona)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }),

    getPersona: async ({ personaId }) => {
      const persona = personasById.get(personaId);
      if (persona === undefined) return { persona: null };
      // Fresh source bodies for the pool entries this response renders.
      await Promise.all([refreshNoteBodies(), refreshDocBodies()]);
      return { persona: toWirePersona(persona) };
    },

    // Writes a bare row immediately so the editor has a personaId to autosave
    // against from the very first keystroke. The editor seeds and saves
    // provider/model/name itself via savePersona right after.
    createPersona: () => {
      const now = Date.now();
      const id = newPersonaId();
      // promptsFor registers the pool before the persona exists so the array
      // the persona holds is the same one the prompt RPCs mutate.
      const persona: Persona = {
        id,
        name: "",
        emoji: pickEmoji(),
        color: null,
        threadTagId: null,
        prompts: promptsFor(id),
        providerId: "",
        model: "",
        reasoningLevel: null,
        projectId: null,
        defaultUserMessage: "",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO personas (id, name, emoji, color, instructions, provider_id, model,
                            reasoning_level, project_id, default_user_message, status,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?)`,
      ).run(
        persona.id,
        persona.name,
        persona.emoji,
        persona.color,
        persona.providerId,
        persona.model,
        persona.reasoningLevel,
        persona.projectId,
        persona.status,
        persona.createdAt,
        persona.updatedAt,
      );
      personasById.set(persona.id, persona);
      announce();
      return { personaId: persona.id };
    },

    // Applies only the keys the editor actually sent — an autosave from a
    // half-typed form must never blow away fields the user hasn't touched
    // yet — and never touches status; that's publishPersona's job alone.
    // The Default User Message normalizes here: trimmed, length-bounded,
    // whitespace-only collapsed to "" (none provided).
    savePersona: ({ personaId, patch }) => {
      const existing = readPersona(personaId);
      const persona: Persona = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.providerId !== undefined
          ? { providerId: patch.providerId }
          : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.reasoningLevel !== undefined
          ? { reasoningLevel: patch.reasoningLevel }
          : {}),
        ...(patch.projectId !== undefined
          ? { projectId: patch.projectId }
          : {}),
        ...(patch.defaultUserMessage !== undefined
          ? { defaultUserMessage: clampDefaultUserMessage(patch.defaultUserMessage) }
          : {}),
        updatedAt: Date.now(),
      };
      db.prepare(
        `UPDATE personas
            SET name = ?, emoji = ?, color = ?, provider_id = ?,
                model = ?, reasoning_level = ?, project_id = ?,
                default_user_message = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        persona.name,
        persona.emoji,
        persona.color,
        persona.providerId,
        persona.model,
        persona.reasoningLevel,
        persona.projectId,
        persona.defaultUserMessage,
        persona.updatedAt,
        persona.id,
      );
      personasById.set(persona.id, persona);
      announce();
      return { ok: true };
    },

    // Prompt-pool writes. No uniqueness rule: the pool is the user's to curate,
    // and duplicates (including two entries pointing at one note) are theirs
    // to make and remove.
    addPersonaPrompt: async ({ personaId, ...addition }) => {
      const persona = readPersona(personaId);
      const prompts = promptsFor(personaId);
      const now = Date.now();
      let prompt: PersonaPrompt;
      if (addition.type === "note") {
        prompt = {
          id: newPromptId(),
          personaId,
          type: "note",
          // The durable reference, not the note's current text — that's what
          // keeps the entry live as the note is edited later.
          text: encodeNotePromptRef(addition.noteId),
          position:
            prompts.reduce((max, entry) => Math.max(max, entry.position), -1) +
            1,
          createdAt: now,
          updatedAt: now,
        };
      } else if (addition.type === "doc") {
        prompt = {
          id: newPromptId(),
          personaId,
          type: "doc",
          // The durable reference, not the file's current content — that's
          // what keeps the entry live as the file is edited later.
          text: encodeDocPromptRef(addition.vaultId, addition.path),
          position:
            prompts.reduce((max, entry) => Math.max(max, entry.position), -1) +
            1,
          createdAt: now,
          updatedAt: now,
        };
      } else {
        const clamped = clampPromptText(addition.text);
        if (clamped.length === 0) {
          throw new Error("A prompt needs some text");
        }
        prompt = {
          id: newPromptId(),
          personaId,
          type: "text",
          text: clamped,
          position:
            prompts.reduce((max, entry) => Math.max(max, entry.position), -1) +
            1,
          createdAt: now,
          updatedAt: now,
        };
      }
      db.prepare(
        `INSERT INTO persona_prompts (id, persona_id, type, text, position,
                                  created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        prompt.id,
        prompt.personaId,
        prompt.type,
        prompt.text,
        prompt.position,
        prompt.createdAt,
        prompt.updatedAt,
      );
      prompts.push(prompt);
      touchPersona(persona, now);
      // Attach time is the first moment the source's content is needed, so
      // read it now: the response below (and the editor's reload) shows live
      // text.
      if (prompt.type === "note") await refreshNoteBodies();
      if (prompt.type === "doc") await refreshDocBodies();
      announce();
      return { prompt: toWirePrompt(prompt) };
    },

    updatePersonaPrompt: ({ personaId, promptId, text }) => {
      const persona = readPersona(personaId);
      const prompts = promptsFor(personaId);
      const prompt = prompts.find((entry) => entry.id === promptId);
      if (prompt === undefined) throw new Error(`Unknown prompt: ${promptId}`);
      // A live prompt points at its source; its own body is a reference, not
      // prose, so there is nothing to edit. Remove and re-attach instead.
      if (prompt.type === "note") {
        throw new Error(
          "Note prompts can't be edited — remove the entry and attach the note again",
        );
      }
      if (prompt.type === "doc") {
        throw new Error(
          "Docs prompts can't be edited — remove the entry and attach the file again",
        );
      }
      const clamped = clampPromptText(text);
      if (clamped.length === 0) {
        throw new Error("A prompt needs some text");
      }
      const now = Date.now();
      prompt.text = clamped;
      prompt.updatedAt = now;
      db.prepare(
        "UPDATE persona_prompts SET text = ?, updated_at = ? WHERE id = ?",
      ).run(clamped, now, promptId);
      touchPersona(persona, now);
      announce();
      return { prompt: toWirePrompt(prompt) };
    },

    removePersonaPrompt: ({ personaId, promptId }) => {
      const persona = readPersona(personaId);
      const prompts = promptsFor(personaId);
      const index = prompts.findIndex((entry) => entry.id === promptId);
      if (index === -1) throw new Error(`Unknown prompt: ${promptId}`);
      prompts.splice(index, 1);
      db.prepare("DELETE FROM persona_prompts WHERE id = ?").run(promptId);
      touchPersona(persona, Date.now());
      announce();
      return { ok: true };
    },

    // Publishing an already-published persona is a no-op success — the editor
    // doesn't need to know which state it started in.
    publishPersona: ({ personaId }) => {
      const existing = readPersona(personaId);
      if (existing.status === "published") return { ok: true };
      const blockers = draftBlockers(existing);
      if (blockers.length > 0) {
        throw new Error(`Missing: ${blockers.join(", ")}`);
      }
      const persona: Persona = {
        ...existing,
        status: "published",
        updatedAt: Date.now(),
      };
      db.prepare("UPDATE personas SET status = ?, updated_at = ? WHERE id = ?").run(
        persona.status,
        persona.updatedAt,
        persona.id,
      );
      personasById.set(persona.id, persona);
      announce();
      return { ok: true };
    },

    // Deletes the persona, its prompt pool, and its thread mappings. The
    // threads themselves are real conversations, so they stay — they just
    // stop receiving the persona.
    deletePersona: ({ personaId }) => {
      db.prepare("DELETE FROM persona_prompts WHERE persona_id = ?").run(personaId);
      db.prepare("DELETE FROM persona_threads WHERE persona_id = ?").run(personaId);
      db.prepare("DELETE FROM personas WHERE id = ?").run(personaId);
      personasById.delete(personaId);
      promptsByPersonaId.delete(personaId);
      for (const [threadId, mapped] of personaIdByThreadId) {
        if (mapped === personaId) personaIdByThreadId.delete(threadId);
      }
      announce();
      return { ok: true };
    },

    // Two threads.list calls (active, archived) run concurrently — still
    // never a per-thread threads.get loop, and still filtered by our own
    // mapping so a persona only ever sees its own chats.
    listChats: async ({ personaId }) => {
      const mine = new Set(
        (
          db
            .prepare("SELECT thread_id FROM persona_threads WHERE persona_id = ?")
            .all(personaId) as { thread_id: string }[]
        ).map((row) => row.thread_id),
      );
      if (mine.size === 0) return { chats: [], archivedChats: [] };
      const [activeThreads, archivedThreads] = await Promise.all([
        bb.sdk.threads.list({
          originPluginId: bb.pluginId,
          limit: 200,
          archived: false,
        }),
        bb.sdk.threads.list({
          originPluginId: bb.pluginId,
          limit: 200,
          archived: true,
        }),
      ]);
      const toChat = (thread: (typeof activeThreads)[number]) => ({
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title ?? thread.titleFallback,
        status: thread.status,
        updatedAt: thread.updatedAt,
        pinnedAt: thread.pinnedAt,
        archivedAt: thread.archivedAt,
      });
      return {
        chats: sortChats(
          activeThreads.filter((thread) => mine.has(thread.id)).map(toChat),
        ),
        // Archived chats are never pinned in the UI (pin/unpin only act on
        // the active list), so a plain updatedAt-desc sort is enough here —
        // sortChats' pinned bucket would be a no-op.
        archivedChats: archivedThreads
          .filter((thread) => mine.has(thread.id))
          .map(toChat)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      };
    },

    // The rail's one round trip: a single threads.list call, bucketed by
    // persona_threads in memory. Never a per-persona threads.list or a per-thread
    // threads.get.
    listRail: async () => {
      // Fresh source bodies: the rail's subtitle renders pool previews.
      await Promise.all([refreshNoteBodies(), refreshDocBodies()]);
      const chatsByPersonaId = new Map<
        string,
        { threadId: string; title: string | null; status: string; updatedAt: number }[]
      >();
      const personaIdByThreadIdRows = db
        .prepare("SELECT thread_id, persona_id FROM persona_threads")
        .all() as { thread_id: string; persona_id: string }[];
      const personaIdByOwnThreadId = new Map(
        personaIdByThreadIdRows.map((row) => [row.thread_id, row.persona_id]),
      );
      // Excludes archived threads: an archived chat is put away on purpose,
      // so it must not resurface as the rail's subtitle or bump
      // lastActivityAt back to the top of the persona list.
      const threads = await bb.sdk.threads.list({
        originPluginId: bb.pluginId,
        limit: 200,
        archived: false,
      });
      for (const thread of threads) {
        const personaId = personaIdByOwnThreadId.get(thread.id);
        if (personaId === undefined) continue;
        const chats = chatsByPersonaId.get(personaId) ?? [];
        chats.push({
          threadId: thread.id,
          title: thread.title ?? thread.titleFallback,
          status: thread.status,
          updatedAt: thread.updatedAt,
        });
        chatsByPersonaId.set(personaId, chats);
      }
      const personas = [...personasById.values()].map((persona) => {
        const chats = (chatsByPersonaId.get(persona.id) ?? []).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        const newestChatAt = chats[0]?.updatedAt ?? 0;
        return {
          ...toWirePersona(persona),
          chats,
          lastActivityAt: Math.max(persona.updatedAt, newestChatAt),
        };
      });
      personas.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      return { personas };
    },

    // The Thread Info chip (PersonaThreadChip) asks which persona one thread
    // belongs to. The mapping is the same one contributeInstructions reads,
    // written by the dispatch hook when a message carrying this plugin's
    // persona-pill mention first dispatches.
    getPersonaForThread: async ({ threadId }) => {
      const personaId = personaIdByThreadId.get(threadId);
      if (personaId === undefined) return { persona: null };
      const persona = personasById.get(personaId);
      if (persona === undefined) return { persona: null };
      return {
        persona: {
          id: persona.id,
          name: persona.name,
          emoji: persona.emoji,
          color: persona.color,
        },
      };
    },

    // The frontend's experimental_useSidebarThreadActions() hook covers
    // pin/rename/archive/delete directly against the host, so this is the
    // only mutation the plugin itself needs to expose. The ownership check
    // below is load-bearing: without it, any caller of this RPC could pass
    // an arbitrary threadId and unarchive a thread that has nothing to do
    // with this plugin's personas.
    unarchiveChat: async ({ threadId }) => {
      // personaIdByThreadId is the in-memory mirror of persona_threads kept in sync
      // by the dispatch hook/deletePersona/thread.deleted, so checking it here is the
      // same "is this ours" test contributeInstructions already relies on —
      // no need for a separate SELECT against the table it mirrors.
      if (personaIdByThreadId.get(threadId) === undefined) {
        throw new Error(`Unknown chat: ${threadId}`);
      }
      await bb.sdk.threads.unarchive({ threadId });
      announce();
      return { ok: true };
    },

    listOptions: async () => {
      const [providers, projects, allProjects] = await Promise.all([
        bb.sdk.providers.list(),
        bb.sdk.projects.list(),
        bb.sdk.projects.list({ includePersonal: true }),
      ]);
      const personal = allProjects.find(
        (project) => project.kind === "personal",
      );
      return {
        providers: providers.map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          available: provider.available,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        personalProjectId: personal?.id ?? null,
      };
    },

    // The handler type guards each reasoning-effort field against the host's
    // literal set, while the SDK returns them as plain `string` now; the
    // values come from the host's own picker, so cast once at the boundary
    // instead of mirroring the host's internal union here.
    listModels: async ({ providerId }) => {
      const options = await bb.sdk.providers.models({ providerId });
      const models = options.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
        defaultReasoningEffort:
          model.defaultReasoningEffort as z.output<typeof ReasoningLevel>,
        reasoningEfforts: model.supportedReasoningEfforts.map(
          (effort): z.output<typeof ReasoningLevel> =>
            effort.reasoningEffort as z.output<typeof ReasoningLevel>,
        ),
      }));
      return { models };
    },

    // One fresh plugins.list read per call — installs, enables, disables, and
    // removes change the answer, so it is never cached. The flag is also the
    // server-side gate: other parts of this plugin call
    // isFloatingNotesAvailable (plugin-health.ts) against the same list.
    getPluginHealth: async () => {
      const { plugins } = await bb.sdk.plugins.list();
      const health = pluginHealth(plugins, bb.pluginId);
      return {
        ...health,
        self: {
          ...health.self,
          sourceLabel:
            health.self.source === null
              ? null
              : selfInstallLabel(health.self.source),
        },
      };
    },

    // -- Export / import (personas-v1) ---------------------------------------

    exportPersonas: async () => {
      await Promise.all([refreshNoteBodies(), refreshDocBodies()]);
      return {
        personas: [...personasById.values()]
          // Export order mirrors the rail: most recently touched first.
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((persona) =>
            personaToExport(persona, noteBodiesById, docBodiesByRef),
          ),
      };
    },

    importPersonas: async ({ personas }) => {
      // Fresh Floating Note notes once for the whole batch, seeding both the
      // live body cache and the set of note ids that actually exist HERE: a
      // prompt whose noteId survives re-attaches as a live note prompt (and
      // the wire resolves against the fresh body); one that doesn't degrades
      // to the verbatim text the file carries, so nothing is ever dropped.
      // refreshNoteBodies() alone can't do this — it no-ops while no pool
      // holds a note prompt yet, which is exactly the pre-import state.
      const importableNoteIds = new Set<string>();
      try {
        const { plugins } = await bb.sdk.plugins.list();
        if (isFloatingNotesAvailable(plugins)) {
          const listed = await bb.sdk.plugins.callRpc({
            pluginId: FLOATING_NOTES_PLUGIN_ID,
            method: "listNotes",
            input: { view: "active", limit: 500 },
            outputSchema: FloatingNotesListOutput,
          });
          for (const note of listed.notes) {
            importableNoteIds.add(note.id);
            noteBodiesById.set(note.id, note.body);
          }
        }
      } catch {
        // Notes stay unimportable this round; every note prompt degrades to
        // its snapshot text rather than the batch failing.
      }

      // The batch's distinct Docs file refs, read once each so the import
      // both learns which files are reachable HERE and seeds the live body
      // cache with what it read. Docs missing → every doc prompt degrades to
      // its verbatim snapshot text rather than the batch failing.
      const importableDocRefs = new Set<string>();
      try {
        const { plugins } = await bb.sdk.plugins.list();
        if (isDocsAvailable(plugins)) {
          const refs = new Map<string, { vaultId: string; path: string }>();
          for (const entry of personas) {
            if (typeof entry !== "object" || entry === null) continue;
            const prompts = (entry as { prompts?: unknown }).prompts;
            if (!Array.isArray(prompts)) continue;
            for (const prompt of prompts) {
              if (typeof prompt !== "object" || prompt === null) continue;
              const candidate = prompt as Record<string, unknown>;
              if (candidate.type !== "doc") continue;
              if (
                typeof candidate.vaultId !== "string" ||
                typeof candidate.path !== "string" ||
                candidate.vaultId.length === 0 ||
                candidate.path.length === 0
              ) {
                continue;
              }
              refs.set(docPromptRefKey(candidate.vaultId, candidate.path), {
                vaultId: candidate.vaultId,
                path: candidate.path,
              });
            }
          }
          await Promise.all(
            [...refs.values()].map(async (ref) => {
              try {
                const file = await bb.sdk.plugins.callRpc({
                  pluginId: DOCS_PLUGIN_ID,
                  method: "readNote",
                  input: { vaultId: ref.vaultId, path: ref.path },
                  outputSchema: DocsReadNoteOutput,
                });
                if (file.contentEncoding === "utf8") {
                  importableDocRefs.add(docPromptRefKey(ref.vaultId, ref.path));
                  docBodiesByRef.set(
                    docPromptRefKey(ref.vaultId, ref.path),
                    docsPromptBody(file.content),
                  );
                }
              } catch {
                // Unreachable here → the prompt degrades to its snapshot.
              }
            }),
          );
        }
      } catch {
        // Docs stay unimportable this round; every doc prompt degrades to
        // its snapshot text rather than the batch failing.
      }

      const errors: { index: number; error: string }[] = [];
      let imported = 0;
      // Names claimed so far: every existing persona's name, extended by
      // each name this batch has already assigned, so repeated imports of
      // one file and duplicate names within one file both resolve cleanly.
      const usedNames = new Set(
        [...personasById.values()].map((persona) => persona.name),
      );
      for (const [index, entry] of personas.entries()) {
        try {
          const parsed = ExportedPersonaSchema.safeParse(entry);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw new Error(
              issue === undefined
                ? "Invalid persona"
                : `${issue.path.join(".") || "persona"}: ${issue.message}`,
            );
          }
          const exported = parsed.data;
          // A multi-prompt persona can exceed BB's 4096-character
          // instruction budget, but every single prompt obeys the per-prompt
          // clamp — the same cap the editor's addPersonaPrompt enforces.
          const name = uniqueImportName(exported.name.trim() || "Untitled persona", (candidate) =>
            usedNames.has(candidate),
          );
          if (name === null) {
            throw new Error(`No free name for "${exported.name}"`);
          }
          const now = Date.now();
          const personaId = newPersonaId();
          const pool = promptsFor(personaId);
          for (const [position, exportedPrompt] of exported.prompts.entries()) {
            // Downloads and hand-rolled tooling can't be trusted to trim;
            // the pool stores the same clamped prose the editor would have.
            const text = clampPromptText(exportedPrompt.text);
            if (exportedPrompt.type === "note" && text.length === 0) {
              // A note prompt without snapshot text and without a reachable
              // note contributes nothing; store it as a plain note ref so
              // rowToPrompt's decoder still recognizes it, but skip it here
              // only when the note itself is also gone.
              const ref = decodeNotePromptRef(
                exportedPrompt.noteId === undefined
                  ? ""
                  : encodeNotePromptRef(exportedPrompt.noteId),
              );
              if (ref === null || !importableNoteIds.has(ref.noteId)) continue;
            }
            if (exportedPrompt.type === "doc" && text.length === 0) {
              // Same rule for a Docs file: an unreachable source contributes
              // nothing, so an empty-snapshot doc prompt skips itself only
              // when the file can't be read here either.
              const docRef =
                exportedPrompt.vaultId !== undefined &&
                exportedPrompt.path !== undefined
                  ? { vaultId: exportedPrompt.vaultId, path: exportedPrompt.path }
                  : null;
              if (
                docRef === null ||
                !importableDocRefs.has(
                  docPromptRefKey(docRef.vaultId, docRef.path),
                )
              ) {
                continue;
              }
            }
            const isLiveNote =
              exportedPrompt.type === "note" &&
              exportedPrompt.noteId !== undefined &&
              importableNoteIds.has(exportedPrompt.noteId);
            const isLiveDoc =
              exportedPrompt.type === "doc" &&
              exportedPrompt.vaultId !== undefined &&
              exportedPrompt.path !== undefined &&
              importableDocRefs.has(
                docPromptRefKey(exportedPrompt.vaultId, exportedPrompt.path),
              );
            const prompt: PersonaPrompt = {
              id: newPromptId(),
              personaId,
              type: isLiveNote ? "note" : isLiveDoc ? "doc" : "text",
              text: isLiveNote
                ? encodeNotePromptRef(exportedPrompt.noteId!)
                : isLiveDoc
                  ? encodeDocPromptRef(
                      exportedPrompt.vaultId!,
                      exportedPrompt.path!,
                    )
                  : text,
              position,
              createdAt: now,
              updatedAt: now,
            };
            db.prepare(
              `INSERT INTO persona_prompts (id, persona_id, type, text, position,
                                          created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              prompt.id,
              prompt.personaId,
              prompt.type,
              prompt.text,
              prompt.position,
              prompt.createdAt,
              prompt.updatedAt,
            );
            pool.push(prompt);
          }
          // Publish straight when the file carried a usable shape, keeping
          // the source persona's status (decision 3); anything that would
          // fail draftBlockers stays a draft instead of a broken published
          // row. clampDefaultUserMessage normalizes the seeded message.
          const status =
            exported.status === "published" &&
            draftBlockers({
              id: personaId,
              name,
              emoji: exported.emoji,
              color: exported.color,
              threadTagId: null,
              prompts: pool,
              providerId: exported.providerId,
              model: exported.model,
              reasoningLevel: exported.reasoningLevel,
              projectId: null,
              defaultUserMessage: "",
              status: "draft",
              createdAt: now,
              updatedAt: now,
            }).length === 0
              ? "published"
              : "draft";
          const persona: Persona = {
            id: personaId,
            name,
            emoji: exported.emoji,
            color: exported.color,
            // Tag provisioning starts fresh in every instance: the exported
            // file carries no tag ids because the tag sets of two BBs don't
            // share a namespace.
            threadTagId: null,
            prompts: pool,
            providerId: exported.providerId,
            model: exported.model,
            reasoningLevel: exported.reasoningLevel,
            projectId: null,
            defaultUserMessage: clampDefaultUserMessage(exported.defaultUserMessage),
            status,
            createdAt: now,
            updatedAt: now,
          };
          db.prepare(
            `INSERT INTO personas (id, name, emoji, color, instructions, provider_id,
                                  model, reasoning_level, project_id,
                                  default_user_message, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', ?, ?, ?, NULL, ?, ?, ?, ?)`,
          ).run(
            persona.id,
            persona.name,
            persona.emoji,
            persona.color,
            persona.providerId,
            persona.model,
            persona.reasoningLevel,
            persona.defaultUserMessage,
            persona.status,
            persona.createdAt,
            persona.updatedAt,
          );
          personasById.set(persona.id, persona);
          usedNames.add(name);
          imported += 1;
        } catch (cause) {
          errors.push({
            index,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
      if (imported > 0) announce();
      return { imported, skipped: errors.length, errors };
    },

    // -- Thread Tags (bb-plugin-thread-tags) ----------------------------------

    // The settings picker's state read, and the lazy provision point:
    // asking for the state is what gives a tagless persona its default tag.
    // The plugin's absence degrades to availability false and no tags.
    getThreadTagState: async ({ personaId }) => {
      const persona = readPersona(personaId);
      const tag = await ensurePersonaThreadTag(persona);
      if (tag === null) {
        // The plugin just isn't there: report whatever pointer the row
        // already carried (kept for when it's back) and no tags at all.
        return {
          threadTagsAvailable: false,
          threadTagId: persona.threadTagId,
          tags: [],
        };
      }
      const tags = await listThreadTagsOrEmpty();
      return {
        threadTagsAvailable: true,
        threadTagId: persona.threadTagId,
        tags,
      };
    },

    // The settings picker's write path. Re-reads the live tag set so the
    // pointer only ever lands on a tag the other plugin actually knows
    // (a stale or hand-forged id can't hardlink a persona to nothing).
    setPersonaThreadTag: async ({ personaId, threadTagId }) => {
      const persona = readPersona(personaId);
      const { plugins } = await bb.sdk.plugins.list();
      if (!isThreadTagsAvailable(plugins)) {
        throw new Error("Thread Tags is not installed and enabled");
      }
      const tags = await listThreadTagsOrEmpty();
      if (!tags.some((tag) => tag.id === threadTagId)) {
        throw new Error(`Unknown thread tag: ${threadTagId}`);
      }
      // Not a pool edit — updated_at stays put for a tag repoint.
      storeThreadTagId(persona, threadTagId);
      announce();
      return { threadTagId: persona.threadTagId };
    },

    // The one-click install behind the settings page's Thread Tags row.
    // Pinned to the same semver range the marketplace resolves; the bare
    // repository URL is the fallback for hosts that reject range-suffixed
    // git sources. Errors propagate — the UI shows its toast.
    installThreadTags: async () => {
      try {
        const installed = await bb.sdk.plugins.install({
          source: THREAD_TAGS_PLUGIN_SOURCE,
        });
        announce();
        return { ok: true, pluginId: installed?.id ?? THREAD_TAGS_PLUGIN_ID };
      } catch {
        const installed = await bb.sdk.plugins.install({
          source: "https://github.com/VladPolet/bb-plugin-thread-tags",
        });
        announce();
        return { ok: true, pluginId: installed?.id ?? THREAD_TAGS_PLUGIN_ID };
      }
    },

    // -- Prompt-pool sources -------------------------------------------------

    // Active Floating Notes for the "Add Floating Note" picker, newest first.
    // The note's body becomes the prompt text, so it travels with the prompt —
    // later edits to the note never silently rewrite a persona's pool.
    listFloatingNotes: async () => {
      await assertFloatingNotesAvailable();
      const listed = await bb.sdk.plugins.callRpc({
        pluginId: FLOATING_NOTES_PLUGIN_ID,
        method: "listNotes",
        input: { view: "active", limit: 500 },
        outputSchema: FloatingNotesListOutput,
      });
      const notes = [...listed.notes].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      return { notes };
    },

    // Every Docs vault with its markdown documents (newest first) for the
    // "Add Docs document" picker. One listNotes call per vault — a vault
    // that fails to read lists as empty rather than sinking the picker, and
    // a BB with no vault at all lists none.
    listDocsSources: async () => {
      await assertDocsAvailable();
      let first: z.output<typeof DocsListNotesOutput>;
      try {
        first = await bb.sdk.plugins.callRpc({
          pluginId: DOCS_PLUGIN_ID,
          method: "listNotes",
          input: {},
          outputSchema: DocsListNotesOutput,
        });
      } catch {
        // Zero vaults configured: the docs plugin throws instead of
        // answering with an empty list, and an empty picker is the honest
        // readout either way.
        return { vaults: [] };
      }
      const vaults = await Promise.all(
        first.vaults.map(async (vault) => {
          try {
            const listed = await bb.sdk.plugins.callRpc({
              pluginId: DOCS_PLUGIN_ID,
              method: "listNotes",
              input: { vaultId: vault.id },
              outputSchema: DocsListNotesOutput,
            });
            return {
              id: vault.id,
              name: vault.name,
              notes: [...listed.notes].sort(
                (a, b) => b.modifiedAtMs - a.modifiedAtMs,
              ),
            };
          } catch {
            return { id: vault.id, name: vault.name, notes: [] };
          }
        }),
      );
      return { vaults };
    },
  });

  // Keeps the live-body caches warm between the explicit refresh points: a
  // long-lived chat re-reading its persona's instructions mid-conversation, or
  // a second window watching the rail, shouldn't have to wait for the next
  // reader. Each refresh no-ops while no pool holds its prompt type; a
  // failure inside either refresh logs and keeps the last-known bodies.
  bb.background.service("refresh-note-prompts", {
    // The service's start stays pending until the abort signal (reload /
    // disable / shutdown), which is what keeps it "running" in bb's eyes.
    start(signal) {
      void refreshNoteBodies();
      void refreshDocBodies();
      return new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          void refreshNoteBodies();
          void refreshDocBodies();
        }, 60_000);
        signal.addEventListener("abort", () => {
          clearInterval(timer);
          resolve();
        });
      });
    },
  });

  // Keep the mapping from growing without bound. Archived threads are still
  // resumable, so only deletion drops the persona link.
  bb.events.on("thread.deleted", ({ thread }) => {
    if (!personaIdByThreadId.delete(thread.id)) return;
    db.prepare("DELETE FROM persona_threads WHERE thread_id = ?").run(thread.id);
    // Without this, a second open BB window keeps showing a chat that was
    // just deleted from the first window until its next unrelated refresh.
    announce();
  });

  // Deliberately does NOT touch persona_threads: archiving just puts a chat away,
  // it doesn't end it, so the persona mapping must survive until the thread
  // comes back via unarchiveChat (or is actually deleted). Only announce for
  // threads that are ours — bb archives threads belonging to every plugin
  // and to no plugin at all, and this channel exists solely to tell this
  // plugin's own panels to refresh.
  bb.events.on("thread.archived", ({ thread }) => {
    if (personaIdByThreadId.get(thread.id) === undefined) return;
    announce();
  });
}
