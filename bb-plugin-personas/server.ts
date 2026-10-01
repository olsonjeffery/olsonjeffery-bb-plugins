// bb-plugin-personas — backend entry.
//
// A "persona" is a name, an emoji, a pool of prompts, and a model. Chatting
// with one spawns an ordinary BB thread; bb.agents.contributeInstructions then
// injects that persona's joined prompt pool into every turn of that thread.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  clampPromptText,
  decodeNotePromptRef,
  draftBlockers,
  encodeNotePromptRef,
  MAX_NAME,
  MAX_PROMPT_TEXT,
  newPersonaId,
  newPromptId,
  NOTE_UNAVAILABLE_TEXT,
  PERSONA_COLORS,
  pickEmoji,
  resolvePromptTexts,
  renderPersonaInstructions,
  rowToPersona,
  rowToPrompt,
  sortChats,
  type Persona,
  type PersonaPrompt,
  type PersonaPromptRow,
  type PersonaRow,
} from "./personas.js";
import { pluginHealth, selfInstallLabel } from "./plugin-health.js";
import {
  FLOATING_NOTES_PLUGIN_ID,
  isFloatingNotesAvailable,
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
  // "text" carries its own prose; "note" points at a Floating Note.
  type: z.enum(["text", "note"]),
  // For "text" prompts: the prose. For "note" prompts: the note's live body,
  // resolved server-side so the wire never leaks the stored JSON reference.
  text: z.string(),
  // Present only on "note" prompts: the durable Floating Note id this entry
  // points at.
  noteId: z.string().optional(),
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
  prompts: z.array(PersonaPromptSchema),
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: ReasoningLevel.nullable(),
  projectId: z.string().nullable(),
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
  })
  .partial()
  .strict();

const ChatSchema = z.object({
  threadId: z.string(),
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

// Mirrors the host's `promptInputSchema` (bb-plugin-sdk-app.d.ts) exactly.
// This is the part that carries images, so it's spelled out rather than
// left opaque like `environment`/`executionInputSources` below.
const PromptInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    mentions: z.array(z.unknown()).default([]),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("image"),
    url: z.string(),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("localImage"),
    path: z.string(),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("localFile"),
    path: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().optional(),
    visibility: z.literal("agent-only").optional(),
  }),
]);

// The fully-resolved request `experimental_NewThreadComposer` submits.
// `executionInputSources` and `environment` are host-owned opaque shapes —
// mirroring them here would just rot, so they stay unknown and get cast at
// the `threads.spawn` boundary instead.
const NewThreadRequestSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: ReasoningLevel,
  permissionMode: z.string(),
  serviceTier: z.string().optional(),
  executionInputSources: z.record(z.string(), z.unknown()),
  environment: z.unknown(),
  input: z.array(PromptInputSchema).min(1),
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
  // Adds one prompt to a persona's pool: either typed prose (type "text")
  // or a live Floating Note reference (type "note", by durable note id — the
  // note's current body is read at render time, so later edits flow through).
  // Duplicates are allowed; the user curates their own pool.
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
    ]),
    output: z.object({ prompt: PersonaPromptSchema }),
  },
  // Rewrites one TEXT prompt's text. Note prompts aren't editable — remove
  // the entry and attach the note again instead.
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
  startChat: {
    input: z
      .object({ personaId: z.string(), request: NewThreadRequestSchema })
      .strict(),
    output: z.object({ threadId: z.string() }),
  },
  // Pin/rename/archive/delete all come from the host's own
  // experimental_useSidebarThreadActions() hook on the frontend. Unarchive is
  // the one action that hook doesn't expose, so it's the only mutation this
  // plugin needs to provide itself.
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

  // Live Floating Note bodies by durable note id — the read path note prompts
  // resolve against. contributeInstructions is synchronous, so it can only
  // read this cache; the refresh paths below keep the cache fresh.
  const noteBodiesById = new Map<string, string>();

  /** True when any persona's pool holds a note prompt. */
  function anyNotePrompts(): boolean {
    for (const prompts of promptsByPersonaId.values()) {
      if (prompts.some((prompt) => prompt.type === "note")) return true;
    }
    return false;
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
   * One prompt in wire shape. A note prompt never leaks its stored JSON
   * reference: `text` is its note's CURRENT body (or the unavailable marker),
   * and `noteId` carries the durable link the UI renders from.
   */
  function toWirePrompt(prompt: PersonaPrompt) {
    if (prompt.type === "text") return { ...prompt };
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

  // The whole point of the plugin. Returning null for unmapped threads is
  // load-bearing: without it every thread in BB would inherit a persona.
  bb.agents.contributeInstructions(({ threadId }) => {
    const personaId = personaIdByThreadId.get(threadId);
    if (personaId === undefined) return null;
    const persona = personasById.get(personaId);
    if (persona === undefined) return null;
    // Note prompts contribute their notes' CURRENT bodies, read from the
    // cache the refresh paths keep warm.
    return renderPersonaInstructions({
      ...persona,
      prompts: resolvePromptTexts(persona.prompts, noteBodiesById),
    });
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

  bb.rpc.register(rpcContract, {
    listPersonas: () => ({
      personas: [...personasById.values()]
        .map(toWirePersona)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }),

    getPersona: async ({ personaId }) => {
      const persona = personasById.get(personaId);
      if (persona === undefined) return { persona: null };
      // Fresh note bodies for the pool entries this response renders.
      await refreshNoteBodies();
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
        prompts: promptsFor(id),
        providerId: "",
        model: "",
        reasoningLevel: null,
        projectId: null,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO personas (id, name, emoji, color, instructions, provider_id, model,
                            reasoning_level, project_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
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
        updatedAt: Date.now(),
      };
      db.prepare(
        `UPDATE personas
            SET name = ?, emoji = ?, color = ?, provider_id = ?,
                model = ?, reasoning_level = ?, project_id = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        persona.name,
        persona.emoji,
        persona.color,
        persona.providerId,
        persona.model,
        persona.reasoningLevel,
        persona.projectId,
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
      // Attach time is the first moment the note's body is needed, so read it
      // now: the response below (and the editor's reload) shows live text.
      if (prompt.type === "note") await refreshNoteBodies();
      announce();
      return { prompt: toWirePrompt(prompt) };
    },

    updatePersonaPrompt: ({ personaId, promptId, text }) => {
      const persona = readPersona(personaId);
      const prompts = promptsFor(personaId);
      const prompt = prompts.find((entry) => entry.id === promptId);
      if (prompt === undefined) throw new Error(`Unknown prompt: ${promptId}`);
      // A note prompt points at its note; its own body is a reference, not
      // prose, so there is nothing to edit. Remove and re-attach instead.
      if (prompt.type === "note") {
        throw new Error(
          "Note prompts can't be edited — remove the entry and attach the note again",
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
      // Fresh note bodies: the rail's subtitle renders pool previews.
      await refreshNoteBodies();
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

    // The composer already resolved a concrete projectId and environment
    // (including "Don't work in a project", which submits the personal
    // project id, not null), so there's nothing left to resolve here. Note
    // this makes the persona's stored provider/model/project/reasoning SEEDS for
    // the composer, not enforcement — a chat can be started on a different
    // model or project than the persona was configured with, and the persona
    // still applies because contributeInstructions maps per-thread, not
    // per-model.
    startChat: async ({ personaId, request }) => {
      const persona = readPersona(personaId);
      if (persona.status === "draft") {
        throw new Error("Publish this persona before starting a chat");
      }
      // Thread start is when the persona's instructions begin injecting, so
      // the note bodies behind its note prompts must be fresh here.
      await refreshNoteBodies();

      // The composer already validated these against the host's literal
      // unions (permission mode, mention structure, environment /
      // executionInputSources internals). Re-typing them from our
      // deliberately-loose zod schema would just rot, so cast once at the
      // spawn boundary instead of mirroring the host's internal types here.
      const spawnArgs = {
        projectId: request.projectId,
        providerId: request.providerId,
        model: request.model,
        reasoningLevel: request.reasoningLevel,
        permissionMode: request.permissionMode,
        ...(request.serviceTier === undefined
          ? {}
          : { serviceTier: request.serviceTier }),
        executionInputSources: request.executionInputSources,
        environment: request.environment,
        input: request.input,
        // Deliberately omitted: title is optional in CreateThreadRequest and
        // BB auto-titles the thread from its first message. Passing persona.name
        // here used to make every chat literally named after the persona.
      };
      const thread = await bb.sdk.threads.spawn(
        spawnArgs as Parameters<typeof bb.sdk.threads.spawn>[0],
      );

      db.prepare(
        "INSERT INTO persona_threads (thread_id, persona_id, created_at) VALUES (?, ?, ?)",
      ).run(thread.id, persona.id, Date.now());
      personaIdByThreadId.set(thread.id, persona.id);
      bb.log.info(`started chat ${thread.id} for persona ${persona.id}`);
      return { threadId: thread.id };
    },

    // The frontend's experimental_useSidebarThreadActions() hook covers
    // pin/rename/archive/delete directly against the host, so this is the
    // only mutation the plugin itself needs to expose. The ownership check
    // below is load-bearing: without it, any caller of this RPC could pass
    // an arbitrary threadId and unarchive a thread that has nothing to do
    // with this plugin's personas.
    unarchiveChat: async ({ threadId }) => {
      // personaIdByThreadId is the in-memory mirror of persona_threads kept in sync
      // by startChat/deletePersona/thread.deleted, so checking it here is the
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

    listModels: async ({ providerId }) => {
      const options = await bb.sdk.providers.models({ providerId });
      return {
        models: options.models.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          description: model.description,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          reasoningEfforts: model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ),
        })),
      };
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
  });

  // Keeps the note-body cache warm between the explicit refresh points: a
  // long-lived chat re-reading its persona's instructions mid-conversation, or
  // a second window watching the rail, shouldn't have to wait for the next
  // reader. No-ops while no pool holds a note prompt; a failure inside
  // refreshNoteBodies logs and keeps the last-known bodies.
  bb.background.service("refresh-note-prompts", {
    // The service's start stays pending until the abort signal (reload /
    // disable / shutdown), which is what keeps it "running" in bb's eyes.
    start(signal) {
      void refreshNoteBodies();
      return new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          void refreshNoteBodies();
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
