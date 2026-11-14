import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import {
  defaultThreadTagLabel,
  threadTagColorHex,
} from "./personas.js";
import type { PluginHealthReport } from "./plugin-health.js";

const PROJECTS = [
  { id: "proj_personal", name: "Personal", kind: "personal", sources: [] },
  { id: "proj_work", name: "Work", kind: "standard", sources: [] },
];

function makeHost() {
  let nextThread = 0;
  return createFakePluginHost({
    pluginId: "personas",
    sdk: {
      projects: { list: async () => PROJECTS },
      plugins: {
        // Floating Notes and the official Docs plugin running by default, so
        // tests that don't care about health see the happy path; health tests
        // stub their own state.
        list: async () => ({
          plugins: [
            {
              id: "personas",
              enabled: true,
              status: "running",
              version: "1.2.0",
            },
            {
              id: "floating-notes",
              enabled: true,
              status: "running",
              version: "1.2.1",
            },
            {
              id: "simple-notes",
              enabled: true,
              status: "running",
              version: "0.2.3",
            },
          ],
        }),
      },
      providers: {
        list: async () => [
          { id: "codex", displayName: "Codex", available: true },
        ],
        models: async () => ({
          models: [
            {
              id: "gpt-5.5",
              displayName: "GPT-5.5",
              description: "",
              isDefault: true,
              model: "gpt-5.5",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }],
            },
          ],
        }),
      },
      threads: {
        spawn: async () => {
          nextThread += 1;
          return { id: `thr_${nextThread}` };
        },
        // Honors `archived` like the real threads.list so listChats/listRail
        // can be tested against both the active and archived buckets; tests
        // that need a richer fixture set override this via
        // host.harness.inspection.sdk.stub("threads.list", ...).
        list: async (args?: { archived?: boolean }) => {
          const all = [
            {
              id: "thr_1",
              projectId: "proj_personal",
              title: "Pirate",
              titleFallback: null,
              status: "idle",
              updatedAt: 10,
              pinnedAt: null,
              archivedAt: null,
            },
          ];
          if (args?.archived === undefined) return all;
          return all.filter(
            (thread) => (thread.archivedAt !== null) === args.archived,
          );
        },
        unarchive: async () => ({ ok: true }),
      },
    },
  });
}

// The full set of fields savePersona accepts, standing in for what the editor
// autosaves once the user has filled everything in. The prompt pool is filled
// separately via addPersonaPrompt, the way the editor's pool form does.
const PATCH = {
  name: "Pirate",
  emoji: "🏴‍☠️",
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
};

const PROMPT_TEXT = "Always answer in pirate speak.";

// -- Persona pill dispatch ---------------------------------------------------
//
// A persona chat now binds at its FIRST dispatch: the New Thread composer's
// message carries the plugin's persona mention pill, and the message.dispatch
// hook maps the (already-created) thread to the persona. The tests drive that
// hook directly, the same way core runs it.

/** The mention resource our picker inserts; wire ids belong to "personas". */
function personaPillBlocks(personaId: string) {
  return [
    {
      type: "text" as const,
      text: `@Persona pill ${personaId} and the user's actual message`,
      mentions: [
        {
          start: 0,
          end: 14,
          resource: {
            kind: "plugin" as const,
            pluginId: "personas",
            // bb namespaces plugin mention item ids on the wire:
            // "${providerId}:${itemId}" — what a real dispatch now carries.
            itemId: `personas:${personaId}`,
            label: "Persona pill",
          },
        },
      ],
      visibility: "agent-only" as const,
    },
  ];
}

/** The same pill as the pre-namespacing wire carried: a bare item id. */
function legacyBarePillBlocks(personaId: string) {
  return personaPillBlocks(personaId).map((block) => ({
    ...block,
    mentions: block.mentions.map((mention) => ({
      ...mention,
      resource: { ...mention.resource, itemId: personaId },
    })),
  }));
}

let nextHookThread = 0;

/**
 * Runs the plugin's message.dispatch hook against a thread whose input
 * carries the persona pill, like core does on the first send of a New Thread
 * composer submission. Returns the (caller-chosen or next fake) thread id.
 */
function dispatchThreadStart(
  personaId: string,
  args: { threadId?: string; attempt?: "start-turn" | "join-turn" } = {},
): string {
  nextHookThread += 1;
  const threadId = args.threadId ?? `thr_pill${nextHookThread}`;
  const handler = host.harness.registrations.hooks["message.dispatch"];
  expect(handler).toBeTypeOf("function");
  const decision = (handler as (context: unknown) => { action: string })(
    {
      thread: makeThreadResponse({ id: threadId }),
      attempt: args.attempt ?? "start-turn",
      input: {
        blocks: personaPillBlocks(personaId),
        text: `@Persona pill ${personaId}`,
      },
    },
  );
  expect(decision).toEqual({ action: "proceed" });
  return threadId;
}

let host: ReturnType<typeof makeHost>;

beforeEach(async () => {
  host = makeHost();
  await plugin(host.bb);
});

// The shape of the one argument bb.sdk.plugins.callRpc receives.
interface CrossRpcArgs {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema?: { parse: (value: unknown) => unknown };
}

/**
 * Stands in for the host's cross-plugin RPC: dispatches on
 * "<pluginId>:<method>", validates each answer through the caller's own
 * outputSchema the way the real host does, and records every call.
 */
function stubCrossPluginRpc(
  handlers: Record<string, (input: unknown) => unknown>,
): CrossRpcArgs[] {
  const calls: CrossRpcArgs[] = [];
  host.harness.inspection.sdk.stub(
    "plugins.callRpc",
    (async (args: CrossRpcArgs) => {
      calls.push(args);
      const handler = handlers[`${args.pluginId}:${args.method}`];
      if (handler === undefined) {
        throw new Error(`no cross-rpc stub for ${args.pluginId}:${args.method}`);
      }
      return args.outputSchema?.parse(handler(args.input));
    }) as never,
  );
  return calls;
}

/** One ListedNote row as Floating Notes' listNotes returns it. */
function makeFloatingNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_1",
    title: "Pirate sayings",
    body: "Always answer in pirate speak.",
    tags: [],
    kind: "note",
    color: null,
    pinned: false,
    pinnedThreadId: null,
    pinnedProjectId: null,
    stickyOpen: false,
    collapsed: false,
    dateKey: null,
    taskTotal: 0,
    taskDone: 0,
    trashedAt: null,
    originProjectId: null,
    originThreadId: null,
    matchSnippet: null,
    threadTitle: null,
    projectName: null,
    createdAt: 1,
    updatedAt: 10,
    ...overrides,
  };
}

// createPersona only ever writes a bare draft row now; tests that need a
// complete, publishable persona go through savePersona + addPersonaPrompt +
// publishPersona the same way the editor does.
async function createPublishedPersona(): Promise<string> {
  const { personaId } = (await host.harness.behavior.callRpc(
    "createPersona",
    null,
  )) as { personaId: string };
  await host.harness.behavior.callRpc("savePersona", { personaId, patch: PATCH });
  await host.harness.behavior.callRpc("addPersonaPrompt", {
    personaId,
    type: "text",
    text: PROMPT_TEXT,
  });
  await host.harness.behavior.callRpc("publishPersona", { personaId });
  return personaId;
}

describe("createPersona / savePersona / publishPersona", () => {
  it("createPersona writes a draft with no name, provider, or model", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { status: string; name: string; providerId: string; model: string } | null };
    expect(persona).toMatchObject({
      status: "draft",
      name: "",
      providerId: "",
      model: "",
    });
  });

  it("savePersona applies only the given keys and never touches status", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { name: "Pirate" },
    });
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { status: string; name: string; providerId: string } | null };
    expect(persona).toMatchObject({
      status: "draft",
      name: "Pirate",
      providerId: "",
    });
  });

  it("publishPersona throws listing every missing field", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await expect(
      host.harness.behavior.callRpc("publishPersona", { personaId }),
    ).rejects.toThrow("Missing: a name, a provider, a model");
  });

  it("publishPersona succeeds once name, provider, and model are all set", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await host.harness.behavior.callRpc("savePersona", { personaId, patch: PATCH });
    const result = (await host.harness.behavior.callRpc("publishPersona", {
      personaId,
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { status: string } | null };
    expect(persona?.status).toBe("published");
  });

  it("publishing an already-published persona is a no-op success", async () => {
    const personaId = await createPublishedPersona();
    const result = (await host.harness.behavior.callRpc("publishPersona", {
      personaId,
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
  });
});

describe("instruction routing", () => {
  it("contributes the persona only to that persona's own threads", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider;
    expect(provide).not.toBeNull();

    const forPersona = provide!({ threadId, projectId: "proj_personal" });
    expect(forPersona).toContain("Pirate");
    expect(forPersona).toContain(PROMPT_TEXT);

    // The guard that keeps personas out of every other thread in BB.
    expect(provide!({ threadId: "thr_unrelated", projectId: "p" })).toBeNull();
  });

  it("binds a dispatch whose pill id carries the pre-namespacing bare shape", async () => {
    // bb serializes plugin mention item ids as "${providerId}:${itemId}" since
    // 0.47; older queued rows and core versions still dispatch bare ids.
    const personaId = await createPublishedPersona();
    const threadId = "thr_bare_pill";
    const handler = host.harness.registrations.hooks["message.dispatch"];
    (handler as unknown as (context: unknown) => { action: string })({
      thread: makeThreadResponse({ id: threadId }),
      attempt: "start-turn",
      input: { blocks: legacyBarePillBlocks(personaId), text: "@Persona pill" },
    });
    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      PROMPT_TEXT,
    );
  });

  it("never binds a pill whose item id carries another provider's prefix", async () => {
    // A foreign "providerId:" prefix is not ours even when the plugin id is:
    // the lookup must fail closed rather than strip blindly.
    const personaId = await createPublishedPersona();
    const blocks = personaPillBlocks(personaId).map((block) => ({
      ...block,
      mentions: block.mentions.map((mention) => ({
        ...mention,
        resource: { ...mention.resource, itemId: `other:${personaId}` },
      })),
    }));
    const handler = host.harness.registrations.hooks["message.dispatch"];
    (handler as unknown as (context: unknown) => { action: string })({
      thread: makeThreadResponse({ id: "thr_foreign_pill" }),
      attempt: "start-turn",
      input: { blocks, text: "@Persona pill" },
    });
    const provide = host.harness.registrations.instructionProvider!;
    expect(
      provide({ threadId: "thr_foreign_pill", projectId: "proj_personal" }),
    ).toBeNull();
  });

  it("stops contributing once the persona is deleted", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);
    await host.harness.behavior.callRpc("deletePersona", { personaId });

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toBeNull();
  });

  it("contributes a note prompt's live body, and follows edits to the note", async () => {
    // The note's body changes between reads, the way a real edit would.
    let body = "Feed crackers twice a day.";
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1", body })],
        tags: [],
        counts: { active: 1, trashed: 0 },
      }),
    });

    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "note",
      noteId: "note_1",
    });
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Feed crackers twice a day.",
    );

    // The note is edited in Floating Notes; the persona follows on the next
    // refresh (any reader — here, the editor's getPersona).
    body = "Feed crackers thrice a day, and skip the crackers.";
    await host.harness.behavior.callRpc("getPersona", { personaId });
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Feed crackers thrice a day, and skip the crackers.",
    );
  });

  it("contributes the unavailable marker when the note can't be read", async () => {
    // No listNotes stub at all: every refresh fails, so the cache stays empty.
    stubCrossPluginRpc({});
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "note",
      noteId: "note_missing",
    });
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "[Floating note is unavailable]",
    );
  });

  it("contributes a doc prompt's live content, and follows edits to the file", async () => {
    // The file's content changes between reads, the way a real edit would.
    let content = "Swab the deck daily.";
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content,
        contentEncoding: "utf8",
      }),
    });

    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "doc",
      vaultId: "personal",
      path: "playbooks/pirate.md",
    });
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Swab the deck daily.",
    );

    // The file is edited in Docs; the persona follows on the next refresh
    // (any reader — here, the editor's getPersona).
    content = "Scrub the deck twice daily, and polish the brass.";
    await host.harness.behavior.callRpc("getPersona", { personaId });
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Scrub the deck twice daily, and polish the brass.",
    );
  });

  it("strips front matter from a Docs file before it reaches the display or the agent", async () => {
    // A note export synced into a vault carries its metadata in a --- fenced
    // YAML block at the top of the file; that is file metadata, not persona
    // text, so neither the pool entry nor the injected instructions see it.
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: [
          "---",
          "id: b99f0fd724",
          "kind: note",
          "tags: []",
          "color: lavender",
          "pinned: false",
          "createdAt: 2026-09-25T12:23:14.688Z",
          "updatedAt: 2026-10-02T12:22:17.750Z",
          "---",
          "",
          "# PERSONA: Plan",
          "",
          "Ask the user what GitHub Issue URL they would like to work from.",
        ].join("\n"),
        contentEncoding: "utf8",
      }),
    });
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "doc",
      vaultId: "personal",
      path: "PERSONA/persona-plan-b99f0fd7.md",
    });
    const threadId = dispatchThreadStart(personaId);

    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { prompts: { type: string; text: string }[] } };
    const entry = persona!.prompts.find((prompt) => prompt.type === "doc")!;
    expect(entry.text).not.toContain("id: b99f0fd724");
    expect(entry.text).not.toContain("kind: note");
    expect(entry.text).not.toContain("color: lavender");
    expect(entry.text.startsWith("# PERSONA: Plan")).toBe(true);

    const provide = host.harness.registrations.instructionProvider!;
    const instructions = provide({ threadId, projectId: "proj_personal" });
    expect(instructions).toContain(
      "Ask the user what GitHub Issue URL they would like to work from.",
    );
    expect(instructions).not.toContain("kind: note");
  });

  it("contributes the unavailable marker when the Docs file can't be read", async () => {
    // No readNote stub at all: every refresh fails, so the cache stays empty.
    stubCrossPluginRpc({});
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "doc",
      vaultId: "personal",
      path: "plans/gone.md",
    });
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "[Docs file is unavailable]",
    );
  });

  it("never injects a Docs file that only carries binary bytes", async () => {
    // The path was re-pointed at a binary: readNote answers base64, which is
    // not prompt text, so the entry degrades to the unavailable marker.
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "AAECAw==",
        contentEncoding: "base64",
      }),
    });
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "doc",
      vaultId: "personal",
      path: "attachments/logo.png",
    });
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "[Docs file is unavailable]",
    );
  });
});

describe("prompt pool", () => {
  async function createDraft(): Promise<string> {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    return personaId;
  }

  async function addPrompt(personaId: string, text: string) {
    return (await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "text",
      text,
    })) as { prompt: { id: string; personaId: string; type: string; text: string; position: number } };
  }

  async function getPrompts(personaId: string) {
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { prompts: { id: string; type: string; text: string }[] } | null };
    return persona?.prompts ?? [];
  }

  it("adds a trimmed text prompt tied to that one persona", async () => {
    const personaId = await createDraft();
    const { prompt } = await addPrompt(personaId, `  ${PROMPT_TEXT}  `);
    expect(prompt).toMatchObject({
      personaId,
      type: "text",
      text: PROMPT_TEXT,
      position: 0,
    });
    expect(await getPrompts(personaId)).toHaveLength(1);
  });

  it("allows two prompts whose first characters match — the pool is the user's to curate", async () => {
    const personaId = await createDraft();
    await addPrompt(personaId, `${"a".repeat(30)} one`);
    await expect(
      addPrompt(personaId, `${"a".repeat(24)} entirely different tail`),
    ).resolves.toBeTruthy();
    expect(await getPrompts(personaId)).toHaveLength(2);
  });

  it("allows the same text on a different persona", async () => {
    const first = await createDraft();
    const second = await createDraft();
    await addPrompt(first, PROMPT_TEXT);
    await expect(addPrompt(second, PROMPT_TEXT)).resolves.toBeTruthy();
  });

  it("rejects an empty or whitespace-only prompt", async () => {
    const personaId = await createDraft();
    await expect(addPrompt(personaId, "   ")).rejects.toThrow(
      "A prompt needs some text",
    );
  });

  it("rejects a prompt for an unknown persona", async () => {
    await expect(
      addPrompt("persona_missing", PROMPT_TEXT),
    ).rejects.toThrow("Unknown persona");
  });

  it("updates a prompt's text, and a prompt may keep its own text", async () => {
    const personaId = await createDraft();
    const { prompt } = await addPrompt(personaId, PROMPT_TEXT);

    // Keeping its own text is not a conflict with itself.
    const kept = (await host.harness.behavior.callRpc("updatePersonaPrompt", {
      personaId,
      promptId: prompt.id,
      text: PROMPT_TEXT,
    })) as { prompt: { text: string } };
    expect(kept.prompt.text).toBe(PROMPT_TEXT);

    const updated = (await host.harness.behavior.callRpc(
      "updatePersonaPrompt",
      { personaId, promptId: prompt.id, text: "Never break character." },
    )) as { prompt: { text: string } };
    expect(updated.prompt.text).toBe("Never break character.");
    expect((await getPrompts(personaId))[0]?.text).toBe(
      "Never break character.",
    );
  });

  it("allows an update that matches a sibling prompt's text", async () => {
    const personaId = await createDraft();
    const { prompt: first } = await addPrompt(personaId, `${"b".repeat(30)} one`);
    await addPrompt(personaId, `${"c".repeat(30)} two`);
    const updated = (await host.harness.behavior.callRpc(
      "updatePersonaPrompt",
      { personaId, promptId: first.id, text: `${"c".repeat(24)} different tail` },
    )) as { prompt: { text: string } };
    expect(updated.prompt.text).toBe(`${"c".repeat(24)} different tail`);
    expect(await getPrompts(personaId)).toHaveLength(2);
  });

  it("adds a note prompt as a live reference, storing the note id — not a copy of its text", async () => {
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1", body: "Feed crackers twice a day." })],
        tags: [],
        counts: { active: 1, trashed: 0 },
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      { personaId, type: "note", noteId: "note_1" },
    )) as { prompt: { id: string; type: string; noteId: string; text: string } };

    // The wire carries the live body and the durable link, never the blob.
    expect(prompt).toMatchObject({
      personaId,
      type: "note",
      noteId: "note_1",
      text: "Feed crackers twice a day.",
    });
    // The durable row stores the reference, so later note edits flow through.
    const row = host.bb.storage
      .database()
      .prepare("SELECT type, text FROM persona_prompts WHERE id = ?")
      .get(prompt.id) as { type: string; text: string };
    expect(row.type).toBe("note");
    expect(JSON.parse(row.text)).toEqual({
      kind: "floating-note",
      noteId: "note_1",
    });
  });

  it("lets a persona hold the same note twice — the pool is the user's to curate", async () => {
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1" })],
        tags: [],
        counts: { active: 1, trashed: 0 },
      }),
    });
    const personaId = await createDraft();
    await expect(
      host.harness.behavior.callRpc("addPersonaPrompt", {
        personaId,
        type: "note",
        noteId: "note_1",
      }),
    ).resolves.toBeTruthy();
    await expect(
      host.harness.behavior.callRpc("addPersonaPrompt", {
        personaId,
        type: "note",
        noteId: "note_1",
      }),
    ).resolves.toBeTruthy();
    expect(await getPrompts(personaId)).toHaveLength(2);
  });

  it("rejects editing a note prompt — remove it and attach the note again instead", async () => {
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1" })],
        tags: [],
        counts: { active: 1, trashed: 0 },
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      { personaId, type: "note", noteId: "note_1" },
    )) as { prompt: { id: string } };
    await expect(
      host.harness.behavior.callRpc("updatePersonaPrompt", {
        personaId,
        promptId: prompt.id,
        text: "Hand-edited text.",
      }),
    ).rejects.toThrow("Note prompts can't be edited");
    // The reference survived the rejected edit.
    expect((await getPrompts(personaId))[0]?.type).toBe("note");
  });

  it("adds a doc prompt as a live reference, storing the vault and path — not a copy of the file", async () => {
    const calls = stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "Swab the deck daily.",
        contentEncoding: "utf8",
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      {
        personaId,
        type: "doc",
        vaultId: "personal",
        path: "playbooks/pirate.md",
      },
    )) as {
      prompt: {
        id: string;
        type: string;
        docVaultId?: string;
        docPath?: string;
        text: string;
      };
    };

    // The wire carries the live content and the durable link, never the blob.
    expect(prompt).toMatchObject({
      personaId,
      type: "doc",
      docVaultId: "personal",
      docPath: "playbooks/pirate.md",
      text: "Swab the deck daily.",
    });
    // The read went to the built-in Docs plugin by vault id and path.
    expect(calls[0]).toMatchObject({
      pluginId: "simple-notes",
      method: "readNote",
      input: { vaultId: "personal", path: "playbooks/pirate.md" },
    });
    // The durable row stores the reference, so later file edits flow through.
    const row = host.bb.storage
      .database()
      .prepare("SELECT type, text FROM persona_prompts WHERE id = ?")
      .get(prompt.id) as { type: string; text: string };
    expect(row.type).toBe("doc");
    expect(JSON.parse(row.text)).toEqual({
      kind: "docs-vault",
      vaultId: "personal",
      path: "playbooks/pirate.md",
    });
  });

  it("lets a persona hold the same Docs file twice — the pool is the user's to curate", async () => {
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "Swab the deck daily.",
        contentEncoding: "utf8",
      }),
    });
    const personaId = await createDraft();
    const add = { personaId, type: "doc", vaultId: "personal", path: "playbooks/pirate.md" };
    await expect(
      host.harness.behavior.callRpc("addPersonaPrompt", add),
    ).resolves.toBeTruthy();
    await expect(
      host.harness.behavior.callRpc("addPersonaPrompt", add),
    ).resolves.toBeTruthy();
    expect(await getPrompts(personaId)).toHaveLength(2);
  });

  it("rejects editing a doc prompt — remove it and attach the file again instead", async () => {
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "Swab the deck daily.",
        contentEncoding: "utf8",
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      { personaId, type: "doc", vaultId: "personal", path: "plans/a.md" },
    )) as { prompt: { id: string } };
    await expect(
      host.harness.behavior.callRpc("updatePersonaPrompt", {
        personaId,
        promptId: prompt.id,
        text: "Hand-edited text.",
      }),
    ).rejects.toThrow("Docs prompts can't be edited");
    // The reference survived the rejected edit.
    expect((await getPrompts(personaId))[0]?.type).toBe("doc");
  });

  it("removes a doc prompt like any other pool entry", async () => {
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "Swab the deck daily.",
        contentEncoding: "utf8",
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      { personaId, type: "doc", vaultId: "personal", path: "plans/a.md" },
    )) as { prompt: { id: string } };
    await host.harness.behavior.callRpc("removePersonaPrompt", {
      personaId,
      promptId: prompt.id,
    });
    expect(await getPrompts(personaId)).toHaveLength(0);
  });

  it("removes a note prompt like any other pool entry", async () => {
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1" })],
        tags: [],
        counts: { active: 1, trashed: 0 },
      }),
    });
    const personaId = await createDraft();
    const { prompt } = (await host.harness.behavior.callRpc(
      "addPersonaPrompt",
      { personaId, type: "note", noteId: "note_1" },
    )) as { prompt: { id: string } };
    await host.harness.behavior.callRpc("removePersonaPrompt", {
      personaId,
      promptId: prompt.id,
    });
    expect(await getPrompts(personaId)).toHaveLength(0);
  });

  it("removes one prompt and leaves the persona's other prompts", async () => {
    const personaId = await createDraft();
    const { prompt: first } = await addPrompt(personaId, PROMPT_TEXT);
    await addPrompt(personaId, "Never break character.");

    const result = (await host.harness.behavior.callRpc(
      "removePersonaPrompt",
      { personaId, promptId: first.id },
    )) as { ok: boolean };
    expect(result).toEqual({ ok: true });
    expect((await getPrompts(personaId)).map((prompt) => prompt.text)).toEqual([
      "Never break character.",
    ]);
  });

  it("rejects removing a prompt that isn't one of this persona's own", async () => {
    const owner = await createDraft();
    const other = await createDraft();
    const { prompt } = await addPrompt(owner, PROMPT_TEXT);
    await expect(
      host.harness.behavior.callRpc("removePersonaPrompt", {
        personaId: other,
        promptId: prompt.id,
      }),
    ).rejects.toThrow("Unknown prompt");
  });

  it("deletes the prompt pool with the persona", async () => {
    const personaId = await createDraft();
    await addPrompt(personaId, PROMPT_TEXT);
    await host.harness.behavior.callRpc("deletePersona", { personaId });

    const rows = host.bb.storage
      .database()
      .prepare("SELECT * FROM persona_prompts WHERE persona_id = ?")
      .all(personaId);
    expect(rows).toHaveLength(0);
  });
});

describe("prompt-pool sources", () => {
  it("lists active Floating Notes newest-first, reading only the fields a prompt needs", async () => {
    const calls = stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [
          makeFloatingNote({ id: "note_old", title: "Old", body: "Old body.", updatedAt: 1 }),
          makeFloatingNote({ id: "note_new", title: "New", body: "New body.", updatedAt: 2 }),
        ],
        tags: [],
        counts: { active: 2, trashed: 0 },
      }),
    });

    const { notes } = (await host.harness.behavior.callRpc(
      "listFloatingNotes",
      null,
    )) as { notes: { id: string; title: string; body: string; updatedAt: number }[] };

    // The listNotes call asked Floating Notes for the active view, capped.
    expect(calls[0]).toMatchObject({
      pluginId: "floating-notes",
      method: "listNotes",
      input: { view: "active", limit: 500 },
    });
    expect(notes).toEqual([
      { id: "note_new", title: "New", body: "New body.", updatedAt: 2 },
      { id: "note_old", title: "Old", body: "Old body.", updatedAt: 1 },
    ]);
  });

  it("refuses to list Floating Notes when the plugin isn't available", async () => {
    stubCrossPluginRpc({});
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({ plugins: [] })) as never,
    );

    await expect(
      host.harness.behavior.callRpc("listFloatingNotes", null),
    ).rejects.toThrow("Floating Notes is not installed and enabled");
    expect(
      host.harness.inspection.sdk.callsTo("plugins.callRpc"),
    ).toHaveLength(0);
  });

  it("refuses to list Floating Notes when the plugin isn't available", async () => {
    stubCrossPluginRpc({});
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({ plugins: [] })) as never,
    );

    await expect(
      host.harness.behavior.callRpc("listFloatingNotes", null),
    ).rejects.toThrow("Floating Notes is not installed and enabled");
    expect(
      host.harness.inspection.sdk.callsTo("plugins.callRpc"),
    ).toHaveLength(0);
  });

  it("lists every Docs vault with its documents newest-first, reading only the fields a prompt needs", async () => {
    const calls = stubCrossPluginRpc({
      "simple-notes:listNotes": (input) => {
        const { vaultId } = input as { vaultId?: string };
        if (vaultId === "personal") {
          return {
            vaults: [],
            notes: [
              { path: "plans/old.md", title: "Old", preview: "Old preview.", modifiedAtMs: 1 },
              { path: "plans/new.md", title: "New", preview: "New preview.", modifiedAtMs: 2 },
            ],
            error: null,
          };
        }
        return {
          vaults: [
            { id: "personal", name: "Personal", hostId: null, rootPath: "/docs/personal" },
            { id: "work", name: "Work", hostId: "host_b", rootPath: "/docs/work" },
          ],
          notes: [],
          error: null,
        };
      },
    });

    const { vaults } = (await host.harness.behavior.callRpc(
      "listDocsSources",
      null,
    )) as {
      vaults: Array<{
        id: string;
        name: string;
        notes: { path: string; title: string; preview: string; modifiedAtMs: number }[];
      }>;
    };

    // The vault discovery asked the docs plugin once without a vault id.
    expect(calls[0]).toMatchObject({
      pluginId: "simple-notes",
      method: "listNotes",
      input: {},
    });
    // Each vault's notes are one listNotes call away, newest modified first.
    expect(vaults).toEqual([
      {
        id: "personal",
        name: "Personal",
        notes: [
          { path: "plans/new.md", title: "New", preview: "New preview.", modifiedAtMs: 2 },
          { path: "plans/old.md", title: "Old", preview: "Old preview.", modifiedAtMs: 1 },
        ],
      },
      { id: "work", name: "Work", notes: [] },
    ]);
  });

  it("treats a vault whose listing failed as an empty one", async () => {
    stubCrossPluginRpc({
      "simple-notes:listNotes": (input) => {
        const { vaultId } = input as { vaultId?: string };
        if (vaultId === undefined) {
          return {
            vaults: [{ id: "personal", name: "Personal", hostId: null, rootPath: "/d" }],
            notes: [],
            error: null,
          };
        }
        // The docs plugin reports per-vault failures inline rather than
        // throwing; the vault still lists (empty) instead of sinking.
        return { vaults: [], notes: [], error: "Disk hiccup" };
      },
    });

    const { vaults } = (await host.harness.behavior.callRpc(
      "listDocsSources",
      null,
    )) as { vaults: Array<{ id: string; name: string; notes: unknown[] }> };
    expect(vaults).toEqual([{ id: "personal", name: "Personal", notes: [] }]);
  });

  it("lists no Docs vaults when the plugin has none configured", async () => {
    // Zero vaults: the docs plugin throws instead of answering empty.
    stubCrossPluginRpc({
      "simple-notes:listNotes": () => {
        throw new Error("No vault configured");
      },
    });
    const { vaults } = (await host.harness.behavior.callRpc(
      "listDocsSources",
      null,
    )) as { vaults: unknown[] };
    expect(vaults).toEqual([]);
  });

  it("refuses to list Docs sources when the plugin isn't available", async () => {
    stubCrossPluginRpc({});
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({ plugins: [] })) as never,
    );

    await expect(
      host.harness.behavior.callRpc("listDocsSources", null),
    ).rejects.toThrow("Docs is not installed and enabled");
    expect(
      host.harness.inspection.sdk.callsTo("plugins.callRpc"),
    ).toHaveLength(0);
  });
});

describe("persona pills", () => {
  // The pill was placed by the picker (a published persona), so this helper
  // makes the draft's own honest state: a draft persona pill maps to nothing.
  it("maps the new thread to the pill's persona on its first dispatch", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    const contributed = provide({ threadId, projectId: "proj_personal" });
    expect(contributed).toContain("Pirate");
    expect(contributed).toContain(PROMPT_TEXT);

    // The chip's RPC answers from the same mapping.
    const { persona } = (await host.harness.behavior.callRpc(
      "getPersonaForThread",
      { threadId },
    )) as { persona: { id: string; name: string } | null };
    expect(persona?.id).toBe(personaId);
    expect(persona?.name).toBe("Pirate");
  });

  it("is idempotent: every later pass of the same thread leaves one mapping", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);
    dispatchThreadStart(personaId, { threadId });

    const rows = host.bb.storage
      .database()
      .prepare("SELECT COUNT(*) AS n FROM persona_threads WHERE thread_id = ?")
      .get(threadId) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("skips a join-turn attempt (the thread was already decided about)", async () => {
    const personaId = await createPublishedPersona();
    expect(
      dispatchThreadStart(personaId, { attempt: "join-turn" }),
    ).not.toBe(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(
      provide({ threadId: "thr_pill1", projectId: "proj_personal" }),
    ).toBeNull();

    const { persona } = (await host.harness.behavior.callRpc(
      "getPersonaForThread",
      { threadId: "thr_pill1" },
    )) as { persona: string | null };
    expect(persona).toBeNull();
  });

  it("skips a pill naming a draft persona — publish first", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    dispatchThreadStart(personaId);

    const provide = host.harness.registrations.instructionProvider!;
    expect(
      provide({ threadId: "thr_pill1", projectId: "proj_personal" }),
    ).toBeNull();
  });

  it("skips a pill whose persona no longer exists", async () => {
    dispatchThreadStart("persona_gone");
    const provide = host.harness.registrations.instructionProvider!;
    expect(
      provide({ threadId: "thr_pill1", projectId: "proj_personal" }),
    ).toBeNull();
  });

  it("ignores an ordinary dispatch with no persona pill in its input", async () => {
    nextHookThread += 1;
    const threadId = `thr_plain${nextHookThread}`;
    const handler = host.harness.registrations.hooks["message.dispatch"];
    const decision = (handler as (context: unknown) => { action: string })({
      thread: makeThreadResponse({ id: threadId }),
      attempt: "start-turn",
      input: {
        blocks: [{ type: "text", text: "plain message", mentions: [] }],
        text: "plain message",
      },
    });
    expect(decision).toEqual({ action: "proceed" });
    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toBeNull();
    const { persona } = (await host.harness.behavior.callRpc(
      "getPersonaForThread",
      { threadId },
    )) as { persona: string | null };
    expect(persona).toBeNull();
  });

  it("resolves this thread's persona (or null) for the Thread Info chip", async () => {
    const personaId = await createPublishedPersona();
    expect(
      (
        (await host.harness.behavior.callRpc("getPersonaForThread", {
          threadId: "thr_unmapped",
        })) as { persona: string | null }
      ).persona,
    ).toBeNull();

    const threadId = dispatchThreadStart(personaId);
    await host.harness.behavior.callRpc("deletePersona", { personaId });
    const { persona } = (await host.harness.behavior.callRpc(
      "getPersonaForThread",
      { threadId },
    )) as { persona: string | null };
    expect(persona).toBeNull();
  });

  it("registers exactly one mention provider with published-persona search", async () => {
    const personaId = await createPublishedPersona();
    const [provider] = host.harness.registrations.mentionProviders;
    expect(provider).toMatchObject({ id: "personas", label: "Personas" });

    const rows = await provider.search({
      trigger: "@",
      query: "pir",
      projectId: null,
      threadId: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(personaId);

    // Drafts never answer the menu.
    await host.harness.behavior.callRpc("createPersona", null);
    const after = await provider.search({
      trigger: "@",
      query: "",
      projectId: null,
      threadId: null,
    });
    expect(after).toHaveLength(1);
  });

  it("resolve() never throws: a deleted persona resolves to a note, a live one to its identity line", async () => {
    const personaId = await createPublishedPersona();
    const [provider] = host.harness.registrations.mentionProviders;

    const live = await provider.resolve(personaId);
    expect(live.context).toContain("Pirate");
    expect(live.context).toContain("Persona");
    // The pool is NOT echoed per message: contributeInstructions injects it
    // per turn, so a resolve() that repeated it would double it.
    expect(live.context).not.toContain(PROMPT_TEXT);

    await host.harness.behavior.callRpc("deletePersona", { personaId });
    const gone = await provider.resolve("persona_deleted");
    expect(gone.context).toContain("no longer exists");
  });
});

describe("persistence", () => {
  it("keeps personas, their thread mapping, and their prompt pool across a reload", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId, { threadId: "thr_keep" });

    await host.harness.lifecycle.reload(plugin);

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: { id: string }[] };
    expect(personas.map((persona) => persona.id)).toEqual([personaId]);

    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { prompts: { text: string }[] } | null };
    expect(persona?.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_TEXT]);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain("Pirate");
  });

  it("saves a chosen color, keeps it across a reload, and Auto returns it to null", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };

    // Fresh personas start auto (null): the stable id-hash tint.
    const { persona: before } = (await host.harness.behavior.callRpc(
      "getPersona",
      { personaId },
    )) as { persona: { color: string | null } | null };
    expect(before?.color).toBeNull();

    const readColor = async () => {
      const { persona } = (await host.harness.behavior.callRpc("getPersona", {
        personaId,
      })) as { persona: { color: string | null } | null };
      return persona === null ? "missing" : persona.color;
    };

    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { color: "rose" },
    });
    expect(await readColor()).toBe("rose");

    // Auto is a real state, not an absence: null clears the choice.
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { color: null },
    });
    expect(await readColor()).toBeNull();

    // The chosen color is durable storage, not session state.
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { color: "rose" },
    });
    await host.harness.lifecycle.reload(plugin);
    expect(await readColor()).toBe("rose");
  });

  it("rejects an out-of-palette color patch at the schema", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await expect(
      host.harness.behavior.callRpc("savePersona", {
        personaId,
        patch: { color: "scarlet" },
      }),
    ).rejects.toThrow();
  });

  it("saves a default user message, keeps it across a reload, and collapses whitespace-only to none-provided", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };

    // Fresh personas have no default user message.
    const { persona: fresh } = (await host.harness.behavior.callRpc(
      "getPersona",
      { personaId },
    )) as { persona: { defaultUserMessage: string } | null };
    expect(fresh?.defaultUserMessage).toBe("");

    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { defaultUserMessage: "Check the notes first." },
    });
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { defaultUserMessage: string } | null };
    expect(persona?.defaultUserMessage).toBe("Check the notes first.");

    // Whitespace-only is none-provided, not prose of spaces.
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { defaultUserMessage: "   \n\t  " },
    });
    const { persona: blank } = (await host.harness.behavior.callRpc(
      "getPersona",
      { personaId },
    )) as { persona: { defaultUserMessage: string } | null };
    expect(blank?.defaultUserMessage).toBe("");

    // Durable storage, not session state.
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { defaultUserMessage: "Check the notes first." },
    });
    await host.harness.lifecycle.reload(plugin);
    const { persona: reloaded } = (await host.harness.behavior.callRpc(
      "getPersona",
      { personaId },
    )) as { persona: { defaultUserMessage: string } | null };
    expect(reloaded?.defaultUserMessage).toBe("Check the notes first.");
  });

  it("rejects a default-user-message patch over the 500-character limit at the schema", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await expect(
      host.harness.behavior.callRpc("savePersona", {
        personaId,
        patch: { defaultUserMessage: "x".repeat(501) },
      }),
    ).rejects.toThrow();
  });

  it("reads a persona from before the default-user-message column existed as none-provided", async () => {
    // Simulates a row written by an earlier schema version: the ALTER's
    // DEFAULT '' is what backfills it, exactly like the status column.
    const db = host.bb.storage.database();
    db.prepare(
      `INSERT INTO personas (id, name, emoji, instructions, provider_id, model,
                         reasoning_level, project_id, created_at, updated_at)
       VALUES ('persona_nomessage', 'Legacy', '🤖', 'Be legacy.', 'codex', 'gpt-5.5',
               'medium', NULL, 1, 1)`,
    ).run();

    const reloaded = await host.harness.lifecycle.reload(plugin);

    const { persona } = (await reloaded.harness.behavior.callRpc("getPersona", {
      personaId: "persona_nomessage",
    })) as { persona: { defaultUserMessage: string } | null };
    expect(persona?.defaultUserMessage).toBe("");
  });

  it("carries a pre-pool instructions column into exactly one text prompt, and only once", async () => {
    // Simulates a database last written before the prompt pool existed: the
    // persona's standing text lives in the legacy `instructions` column.
    const db = host.bb.storage.database();
    db.prepare(
      `INSERT INTO personas (id, name, emoji, instructions, provider_id, model,
                         reasoning_level, project_id, status, created_at, updated_at)
       VALUES ('persona_prepool', 'Legacy', '🤖', 'Be legacy.', 'codex', 'gpt-5.5',
               'medium', NULL, 'published', 1, 1)`,
    ).run();

    const reloaded = await host.harness.lifecycle.reload(plugin);

    const { persona } = (await reloaded.harness.behavior.callRpc("getPersona", {
      personaId: "persona_prepool",
    })) as { persona: { prompts: { type: string; text: string }[] } | null };
    expect(persona?.prompts).toHaveLength(1);
    expect(persona?.prompts[0]).toMatchObject({
      type: "text",
      text: "Be legacy.",
    });

    // The injected block carries the carried-over prompt like a native one.
    // The reload rewires the hook to the reloaded module state, so the new
    // mapping flows into the reloaded instructionProvider below.
    const handler = reloaded.harness.registrations.hooks["message.dispatch"];
    expect(handler).toBeTypeOf("function");
    const threadId = "thr_prepool";
    (handler as unknown as (context: unknown) => { action: string })({
      thread: makeThreadResponse({ id: threadId }),
      attempt: "start-turn",
      input: {
        blocks: personaPillBlocks("persona_prepool"),
        text: "@Persona pill",
      },
    });
    const provide = reloaded.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Be legacy.",
    );

    // A persona the pool already covers (its own rows) is skipped on every
    // later start, so a second reload must not duplicate the prompt.
    const reloadedAgain = await reloaded.harness.lifecycle.reload(plugin);
    const { persona: again } = (await reloadedAgain.harness.behavior.callRpc(
      "getPersona",
      { personaId: "persona_prepool" },
    )) as { persona: { prompts: { text: string }[] } | null };
    expect(again?.prompts).toHaveLength(1);
  });

  it("reads a persona inserted before the status column existed as published", async () => {
    // Simulates a row from before this migration ran: no explicit status,
    // so the ALTER TABLE ... DEFAULT 'published' is what backfills it. Using
    // the plugin's own INSERT column list minus status would defeat the
    // point, so this inserts exactly like the pre-migration schema did.
    const db = host.bb.storage.database();
    db.prepare(
      `INSERT INTO personas (id, name, emoji, instructions, provider_id, model,
                         reasoning_level, project_id, created_at, updated_at)
       VALUES ('persona_legacy', 'Legacy', '🤖', 'Be legacy.', 'codex', 'gpt-5.5',
               'medium', NULL, 1, 1)`,
    ).run();

    // reload() disposes the current host and hands back a fresh one against
    // the same on-disk database, which is what actually re-runs the load
    // path (SELECT * FROM personas) over the row just inserted.
    const reloaded = await host.harness.lifecycle.reload(plugin);

    const { persona } = (await reloaded.harness.behavior.callRpc("getPersona", {
      personaId: "persona_legacy",
    })) as { persona: { status: string } | null };
    expect(persona?.status).toBe("published");
  });

  it("carries rows over from the pre-rename bots tables and drops them", async () => {
    // Simulates a database last written before the plugin was renamed:
    // data lives in `bots` / `bot_threads`, including a mapping that
    // contributeInstructions must keep honoring after the copy.
    const db = host.bb.storage.database();
    db.prepare(
      `CREATE TABLE bots (
         id              TEXT PRIMARY KEY,
         name            TEXT NOT NULL,
         emoji           TEXT NOT NULL,
         instructions    TEXT NOT NULL,
         provider_id     TEXT NOT NULL,
         model           TEXT NOT NULL,
         reasoning_level TEXT,
         project_id      TEXT,
         status          TEXT NOT NULL DEFAULT 'published',
         created_at      INTEGER NOT NULL,
         updated_at      INTEGER NOT NULL
       )`,
    ).run();
    db.prepare(
      `INSERT INTO bots VALUES ('persona_legacy', 'Legacy', '🤖', 'Be legacy.',
                                'codex', 'gpt-5.5', 'medium', NULL, 'published', 1, 1)`,
    ).run();
    db.prepare(
      `CREATE TABLE bot_threads (
         thread_id  TEXT PRIMARY KEY,
         bot_id     TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ).run();
    db.prepare(
      `INSERT INTO bot_threads VALUES ('thr_legacy', 'persona_legacy', 2)`,
    ).run();

    const reloaded = await host.harness.lifecycle.reload(plugin);

    const { persona } = (await reloaded.harness.behavior.callRpc("getPersona", {
      personaId: "persona_legacy",
    })) as { persona: { status: string; name: string } | null };
    expect(persona).toMatchObject({ status: "published", name: "Legacy" });

    const provide = reloaded.harness.registrations.instructionProvider!;
    expect(provide({ threadId: "thr_legacy", projectId: "p" })).toContain(
      "Legacy",
    );

    const tableNames = (
      reloaded.bb.storage
        .database()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tableNames).not.toContain("bots");
    expect(tableNames).not.toContain("bot_threads");
  });
});

describe("listChats", () => {
  it("returns only this persona's threads without a per-thread lookup", async () => {
    const personaId = await createPublishedPersona();
    dispatchThreadStart(personaId, { threadId: "thr_1" });

    const { chats, archivedChats } = (await host.harness.behavior.callRpc(
      "listChats",
      { personaId },
    )) as { chats: unknown[]; archivedChats: unknown[] };
    expect(chats).toEqual([
      {
        threadId: "thr_1",
        projectId: "proj_personal",
        title: "Pirate",
        status: "idle",
        updatedAt: 10,
        pinnedAt: null,
        archivedAt: null,
      },
    ]);
    expect(archivedChats).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("threads.get")).toHaveLength(0);
  });

  it("splits active vs archived threads and excludes threads that aren't this persona's own", async () => {
    const personaId = await createPublishedPersona();
    // Three real threads get mapped to this persona via the dispatch hook
    // (thr_1..thr_3); thr_999 stands in for some other plugin's thread that
    // just happens to come back from threads.list — it must never leak into
    // either bucket.
    dispatchThreadStart(personaId, { threadId: "thr_1" });
    dispatchThreadStart(personaId, { threadId: "thr_2" });

    host.harness.inspection.sdk.stub(
      "threads.list",
      (async (args?: { archived?: boolean }) => {
        const all = [
          {
            id: "thr_1",
            projectId: "proj_work",
            title: "Active one",
            titleFallback: null,
            status: "idle",
            updatedAt: 20,
            pinnedAt: null,
            archivedAt: null,
          },
          {
            id: "thr_2",
            projectId: "proj_work",
            title: "Archived one",
            titleFallback: null,
            status: "idle",
            updatedAt: 5,
            pinnedAt: null,
            archivedAt: 4,
          },
          {
            id: "thr_999",
            projectId: "proj_other",
            title: "Not ours",
            titleFallback: null,
            status: "idle",
            updatedAt: 30,
            pinnedAt: null,
            archivedAt: null,
          },
        ];
        return all.filter(
          (thread) => (thread.archivedAt !== null) === args?.archived,
        );
      }) as never,
    );

    const { chats, archivedChats } = (await host.harness.behavior.callRpc(
      "listChats",
      { personaId },
    )) as { chats: { threadId: string }[]; archivedChats: { threadId: string }[] };
    expect(chats.map((chat) => chat.threadId)).toEqual(["thr_1"]);
    expect(archivedChats.map((chat) => chat.threadId)).toEqual(["thr_2"]);
  });

  it("sorts pinned chats ahead of unpinned ones, then by updatedAt descending", async () => {
    const personaId = await createPublishedPersona();
    dispatchThreadStart(personaId, { threadId: "thr_1" });
    dispatchThreadStart(personaId, { threadId: "thr_2" });
    dispatchThreadStart(personaId, { threadId: "thr_3" });

    host.harness.inspection.sdk.stub(
      "threads.list",
      (async (args?: { archived?: boolean }) => {
        if (args?.archived) return [];
        return [
          {
            id: "thr_1",
            projectId: "proj_work",
            title: "Newest, unpinned",
            titleFallback: null,
            status: "idle",
            updatedAt: 100,
            pinnedAt: null,
            archivedAt: null,
          },
          {
            id: "thr_2",
            projectId: "proj_work",
            title: "Pinned first",
            titleFallback: null,
            status: "idle",
            updatedAt: 10,
            pinnedAt: 50,
            archivedAt: null,
          },
          {
            id: "thr_3",
            projectId: "proj_work",
            title: "Pinned more recently",
            titleFallback: null,
            status: "idle",
            updatedAt: 5,
            pinnedAt: 80,
            archivedAt: null,
          },
        ];
      }) as never,
    );

    const { chats } = (await host.harness.behavior.callRpc("listChats", {
      personaId,
    })) as { chats: { threadId: string }[] };
    expect(chats.map((chat) => chat.threadId)).toEqual([
      "thr_3",
      "thr_2",
      "thr_1",
    ]);
  });
});

describe("unarchiveChat", () => {
  it("rejects a threadId that isn't one of this plugin's own persona threads", async () => {
    await expect(
      host.harness.behavior.callRpc("unarchiveChat", {
        threadId: "thr_not_ours",
      }),
    ).rejects.toThrow("Unknown chat: thr_not_ours");
    expect(host.harness.inspection.sdk.callsTo("threads.unarchive")).toHaveLength(0);
  });

  it("unarchives a chat that belongs to this persona and announces the change", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);

    const result = (await host.harness.behavior.callRpc("unarchiveChat", {
      threadId,
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
    expect(host.harness.inspection.sdk.callsTo("threads.unarchive")).toEqual([
      [{ threadId }],
    ]);
    expect(host.harness.inspection.realtimeSignals.length).toBeGreaterThan(0);
  });
});

describe("thread.archived event", () => {
  it("announces but keeps the persona_threads mapping intact for our own threads", async () => {
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);

    const signalsBefore = host.harness.inspection.realtimeSignals.length;
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: threadId }),
    });

    // Still mapped: contributeInstructions must keep returning this persona's
    // persona once the thread is unarchived and resumed.
    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "Pirate",
    );
    const row = host.bb.storage
      .database()
      .prepare("SELECT thread_id FROM persona_threads WHERE thread_id = ?")
      .get(threadId);
    expect(row).toBeTruthy();
    expect(host.harness.inspection.realtimeSignals.length).toBeGreaterThan(
      signalsBefore,
    );
  });

  it("does not announce for a thread that isn't mapped to any of our personas", async () => {
    const signalsBefore = host.harness.inspection.realtimeSignals.length;
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thr_not_ours" }),
    });
    expect(host.harness.inspection.realtimeSignals.length).toBe(
      signalsBefore,
    );
  });
});

describe("listOptions", () => {
  it("returns the personal project id alongside the picker lists", async () => {
    const { personalProjectId } = (await host.harness.behavior.callRpc(
      "listOptions",
      null,
    )) as { personalProjectId: string | null };
    expect(personalProjectId).toBe("proj_personal");
  });
});

describe("getPluginHealth", () => {
  it("reports Floating Notes available when it is installed, enabled, and running", async () => {
    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;

    expect(health.floatingNotesAvailable).toBe(true);
    expect(health.tools).toEqual([
      {
        id: "floating-notes",
        label: "Floating Notes",
        installed: true,
        enabled: true,
        status: "running",
        version: "1.2.1",
        // No install link once the plugin is present.
        installUrl: null,
        available: true,
      },
      {
        // Not in this host's default list: the row reports the absence —
        // with the install link the one-click button hangs off.
        id: "thread-tags",
        label: "Thread Tags",
        installed: false,
        enabled: false,
        status: null,
        version: null,
        installUrl: "https://github.com/VladPolet/bb-plugin-thread-tags",
        available: false,
      },
      {
        // The built-in Docs plugin runs in the default host list: the row
        // reads available, with no install link because it ships with BB.
        id: "simple-notes",
        label: "Docs",
        installed: true,
        enabled: true,
        status: "running",
        version: "0.2.3",
        installUrl: null,
        available: true,
      },
    ]);
    expect(health.threadTagsAvailable).toBe(false);
    expect(health.docsAvailable).toBe(true);
  });

  it("reports the install source of the Personas plugin itself", async () => {
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({
        plugins: [
          {
            id: "personas",
            enabled: true,
            status: "running",
            version: "1.9.0",
            source: "path:/home/me/src/bb-plugin-personas",
          },
        ],
      })) as never,
    );

    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;

    expect(health.self).toEqual({
      version: "1.9.0",
      source: "path:/home/me/src/bb-plugin-personas",
      managed: false,
      sourceLabel:
        "Local path install — /home/me/src/bb-plugin-personas",
    });
  });

  it("degrades the self row when the plugin list carries no source", async () => {
    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;

    expect(health.self).toEqual({
      version: "1.2.0",
      source: null,
      managed: false,
      sourceLabel: null,
    });
  });

  it("reports each missing plugin with its own plugin page link", async () => {
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({
        plugins: [
          { id: "personas", enabled: true, status: "running", version: "1.2.0" },
        ],
      })) as never,
    );

    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;

    expect(health.floatingNotesAvailable).toBe(false);
    expect(health.tools).toEqual([
      {
        id: "floating-notes",
        label: "Floating Notes",
        installed: false,
        enabled: false,
        status: null,
        version: null,
        installUrl: "https://github.com/vburojevic/bb-plugin-floating-notes",
        available: false,
      },
      {
        id: "thread-tags",
        label: "Thread Tags",
        installed: false,
        enabled: false,
        status: null,
        version: null,
        installUrl: "https://github.com/VladPolet/bb-plugin-thread-tags",
        available: false,
      },
      {
        // Missing too — but a built-in has no install link to offer.
        id: "simple-notes",
        label: "Docs",
        installed: false,
        enabled: false,
        status: null,
        version: null,
        installUrl: null,
        available: false,
      },
    ]);
  });

  it("reports Floating Notes unavailable when it is installed but disabled", async () => {
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({
        plugins: [
          { id: "personas", enabled: true, status: "running", version: "1.2.0" },
          {
            id: "floating-notes",
            enabled: false,
            status: "disabled",
            version: "1.2.1",
          },
        ],
      })) as never,
    );

    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;

    // Installed, so no install link — but the flag must stay false so
    // nothing gates a feature on a disabled plugin.
    expect(health.floatingNotesAvailable).toBe(false);
    expect(health.tools[0]).toMatchObject({
      installed: true,
      enabled: false,
      status: "disabled",
      installUrl: null,
      available: false,
    });
  });

  it("reads the plugin list fresh on every call", async () => {
    await host.harness.behavior.callRpc("getPluginHealth", null);

    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({ plugins: [] })) as never,
    );

    const health = (await host.harness.behavior.callRpc(
      "getPluginHealth",
      null,
    )) as PluginHealthReport;
    expect(health.floatingNotesAvailable).toBe(false);
    expect(host.harness.inspection.sdk.callsTo("plugins.list")).toHaveLength(2);
  });
});

describe("Thread Tags", () => {
  const THREAD_TAG_ROW = {
    id: "thread-tags",
    enabled: true,
    status: "running",
    version: "0.1.0",
  };

  /** The default set thread-tags v0.1.0 ships, plus anything tag_create adds. */
  let tags: { id: string; label: string; color: string }[];
  let assignments: Record<string, string>;
  /** The tags this fixture's tag_create has emitted, in call order. */
  let createdTags: { id: string; label: string; color: string }[];
  let nextTagNumber = 0;

  /** Puts thread-tags on the installed list and bases its RPCs like the real plugin. */
  function makeThreadTagsAvailable() {
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({
        plugins: [
          { id: "personas", enabled: true, status: "running", version: "1.2.0" },
          THREAD_TAG_ROW,
        ],
      })) as never,
    );
    return stubCrossPluginRpc({
      "thread-tags:state_get": () => ({
        tags: tags.map((tag) => ({ ...tag })),
        assignments: { ...assignments },
      }),
      "thread-tags:tag_create": (input) => {
        const spec = input as { label: string; color: string };
        const tag = {
          // Never collides across a test: the counter only moves forward, so
          // even a re-provision after a filtered-out tag gets a fresh id.
          id: `tag_${(nextTagNumber += 1)}`,
          label: spec.label,
          color: spec.color,
        };
        tags.push(tag);
        createdTags.push(tag);
        return tag;
      },
      "thread-tags:thread_set_tag": (input) => {
        const spec = input as { threadId: string; tagId: string | null };
        if (spec.tagId === null) delete assignments[spec.threadId];
        else assignments[spec.threadId] = spec.tagId;
        return { tagId: spec.tagId };
      },
    });
  }

  beforeEach(() => {
    tags = [
      { id: "urgent", label: "🔥", color: "#ef4444" },
      { id: "done", label: "✅", color: "#22c55e" },
    ];
    assignments = {};
    createdTags = [];
    nextTagNumber = 0;
  });

  it("reports unavailable with no tags and leaves the persona pointer alone", async () => {
    const personaId = await createPublishedPersona();
    const state = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagsAvailable: boolean; threadTagId: string | null; tags: unknown[] };
    expect(state).toEqual({ threadTagsAvailable: false, threadTagId: null, tags: [] });
  });

  it("provisions a default tag from the persona's emoji on first need", async () => {
    const calls = makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    // The activity timestamp before the tag exists — the pointer write below
    // must not move it.
    const before = ((await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { updatedAt: number } | null }).persona!.updatedAt;

    const state = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagsAvailable: boolean; threadTagId: string | null; tags: { id: string }[] };

    expect(state.threadTagsAvailable).toBe(true);
    const created = createdTags[0]!;
    expect(state.threadTagId).toBe(created.id);
    expect(state.tags).toHaveLength(3);
    // The created tag carries the persona's emoji. The persona row stores the
    // pointer too.
    expect(created).toMatchObject({ label: "🏴‍☠️", color: expect.any(String) });
    const after = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { threadTagId: string | null; updatedAt: number } | null };
    expect(after.persona?.threadTagId).toBe(created.id);
    // Plumbing, not activity: the pointer write doesn't re-sort the rail.
    expect(after.persona?.updatedAt).toBe(before);
  });

  it("keeps a still-valid tag and creates nothing", async () => {
    const calls = makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    const first = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagId: string };

    calls.length = 0;
    const second = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagId: string };

    expect(second.threadTagId).toBe(first.threadTagId);
    expect(calls.some((call) => call.method === "tag_create")).toBe(false);
    expect(tags).toHaveLength(3);
  });

  it("re-provisions when its tag disappears from the set", async () => {
    makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    const first = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagId: string };

    tags = tags.filter((tag) => tag.id !== first.threadTagId);
    const second = (await host.harness.behavior.callRpc("getThreadTagState", {
      personaId,
    })) as { threadTagId: string };

    expect(second.threadTagId).not.toBe(first.threadTagId);
    expect(tags).toHaveLength(3);
  });

  it("provisions from the persona's title, and clamps the label to Thread Tags' 12-char cap", async () => {
    expect(defaultThreadTagLabel("🏴‍☠️", "Pirate")).toBe("🏴‍☠️");
    expect(defaultThreadTagLabel("engineering", "Code reviewer")).toBe("engineering");
    expect(defaultThreadTagLabel("", "Code reviewer")).toBe("Code reviewe");
    // The helper trusts its inputs: blank in, blank out (displayName gives
    // callers their nonzero title beforehand).
    expect(defaultThreadTagLabel("   ", "   ")).toBe("");
  });

  it("colors the default tag with the persona's avatar-tint hex", async () => {
    expect(threadTagColorHex("persona_x", "blue")).toBe("#3b82f6");
    // Colorless personas share the hash slot tintFor picks: same id, same
    // palette hex, every time.
    const auto = threadTagColorHex("persona_1", null);
    expect(auto).toBe(threadTagColorHex("persona_1", null));
    expect(
      ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#06b6d4"],
    ).toContain(auto);
  });

  it("serializes concurrent needs on one persona into one tag", async () => {
    makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    const [first, second] = await Promise.all([
      host.harness.behavior.callRpc("getThreadTagState", { personaId }),
      host.harness.behavior.callRpc("getThreadTagState", { personaId }),
    ]) as { threadTagId: string | null }[];
    expect(first.threadTagId).not.toBeNull();
    expect(second.threadTagId).toBe(first.threadTagId);
    expect(tags).toHaveLength(3);
  });

  it("tags a freshly dispatched thread with the persona's tag", async () => {
    const calls = makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);

    await vi.waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === "thread_set_tag" &&
            (call.input as { threadId?: string }).threadId === threadId,
        ),
      ).toBe(true);
    });
    expect(assignments[threadId]).toBe(createdTags[0]!.id);

    // Every later pass of the same thread must not re-tag: the mapping is
    // written once and the tag job only runs on the first one.
    await dispatchThreadStart(personaId, { threadId });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.filter((call) => call.method === "thread_set_tag")).toHaveLength(1);
  });

  it("binds the thread but never tags when Thread Tags is missing", async () => {
    // No thread-tags on the installed list: applyPersonaThreadTag bails
    // before any cross-plugin call. The recording stub doubles as the gate.
    const calls = stubCrossPluginRpc({});
    const personaId = await createPublishedPersona();
    const threadId = dispatchThreadStart(personaId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      PROMPT_TEXT,
    );
  });

  it("tags with the persona's current tag after the picker repoints it", async () => {
    const calls = makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("setPersonaThreadTag", {
      personaId,
      threadTagId: "urgent",
    });

    const threadId = dispatchThreadStart(personaId);
    await vi.waitFor(() => {
      expect(assignments[threadId]).toBe("urgent");
    });
    expect(
      calls.find((call) => call.method === "thread_set_tag")?.input,
    ).toEqual({ threadId, tagId: "urgent" });
  });

  it("setPersonaThreadTag rejects an unknown tag and stores nothing", async () => {
    makeThreadTagsAvailable();
    const personaId = await createPublishedPersona();
    await expect(
      host.harness.behavior.callRpc("setPersonaThreadTag", {
        personaId,
        threadTagId: "tag_missing",
      }),
    ).rejects.toThrow("Unknown thread tag: tag_missing");
    const { persona } = (await host.harness.behavior.callRpc("getPersona", {
      personaId,
    })) as { persona: { threadTagId: string | null } | null };
    expect(persona?.threadTagId).toBeNull();
  });

  it("setPersonaThreadTag rejects while the plugin is missing", async () => {
    const personaId = await createPublishedPersona();
    await expect(
      host.harness.behavior.callRpc("setPersonaThreadTag", {
        personaId,
        threadTagId: "urgent",
      }),
    ).rejects.toThrow("Thread Tags is not installed and enabled");
  });

  it("the one-click install pins the marketplace range", async () => {
    const installs: unknown[] = [];
    host.harness.inspection.sdk.stub(
      "plugins.install",
      (async (args: unknown) => {
        installs.push(args);
        return { id: "thread-tags" };
      }) as never,
    );

    const result = (await host.harness.behavior.callRpc(
      "installThreadTags",
      null,
    )) as { ok: boolean; pluginId: string | null };

    expect(result).toEqual({ ok: true, pluginId: "thread-tags" });
    expect(installs).toEqual([
      {
        source:
          "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0",
      },
    ]);
  });
});

describe("export/import", () => {
  it("exports one object per persona with prompts verbatim, emoji, and color", async () => {
    const personaId = await createPublishedPersona();
    // A hand-set color exercises the round trip past the default null tint.
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { color: "violet", emoji: "🦜" },
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "exportPersonas",
      null,
    )) as { personas: Array<Record<string, unknown>> };

    expect(personas).toHaveLength(1);
    expect(personas[0]).toMatchObject({
      format: "bb-plugin-personas/v1",
      name: "Pirate",
      emoji: "🦜",
      color: "violet",
      status: "published",
      providerId: "codex",
      model: "gpt-5.5",
      projectId: null,
      prompts: [{ type: "text", text: PROMPT_TEXT }],
    });
    // No source-instance identity leaks into the file.
    expect(personas[0]).not.toHaveProperty("id");
    expect(personas[0]).not.toHaveProperty("createdAt");
  });

  it("exports note prompts as the note's current body plus the durable note id", async () => {
    const personaId = await createPublishedPersona();
    stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1", body: "Fresh note body." })],
      }),
    });
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "note",
      noteId: "note_1",
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "exportPersonas",
      null,
    )) as { personas: Array<{ prompts: Array<{ type: string; text: string; noteId?: string }> }> };

    expect(personas[0]!.prompts).toEqual([
      { type: "text", text: PROMPT_TEXT },
      { type: "note", text: "Fresh note body.", noteId: "note_1" },
    ]);
  });

  it("exports doc prompts as the file's current content plus the vault id and path", async () => {
    const personaId = await createPublishedPersona();
    stubCrossPluginRpc({
      "simple-notes:readNote": () => ({
        content: "Fresh file content.",
        contentEncoding: "utf8",
      }),
    });
    await host.harness.behavior.callRpc("addPersonaPrompt", {
      personaId,
      type: "doc",
      vaultId: "personal",
      path: "playbooks/pirate.md",
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "exportPersonas",
      null,
    )) as {
      personas: Array<{
        prompts: Array<{
          type: string;
          text: string;
          vaultId?: string;
          path?: string;
        }>;
      }>;
    };

    expect(personas[0]!.prompts).toEqual([
      { type: "text", text: PROMPT_TEXT },
      {
        type: "doc",
        text: "Fresh file content.",
        vaultId: "personal",
        path: "playbooks/pirate.md",
      },
    ]);
  });

  it("imports a fresh persona published, with fresh ids and preserved prompt order", async () => {
    const result = (await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          format: "bb-plugin-personas/v1",
          name: "Pirate",
          emoji: "🦜",
          color: "rose",
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: "medium",
          projectId: "proj_somewhere_else",
          defaultUserMessage: "Ahoy.",
          prompts: [
            { type: "text", text: "First." },
            { type: "text", text: "Second." },
          ],
        },
      ],
    })) as { imported: number; skipped: number; errors: unknown[] };

    expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [] });

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ id: string; name: string; status: string; prompts: Array<{ text: string; position: number }>; projectId: string | null; defaultUserMessage: string; color: string | null }> };
    expect(personas).toHaveLength(1);
    expect(personas[0]).toMatchObject({
      name: "Pirate",
      status: "published",
      color: "rose",
      projectId: null,
      defaultUserMessage: "Ahoy.",
    });
    expect(personas[0]!.prompts.map((p) => p.text)).toEqual(["First.", "Second."]);
    expect(personas[0]!.prompts.map((p) => p.position)).toEqual([0, 1]);
  });

  it("renames on name collision as (NEW-IMPORT) and keeps the batch self-consistent", async () => {
    await createPublishedPersona();
    const filePersona = {
      format: "bb-plugin-personas/v1",
      name: "Pirate",
      emoji: "🦜",
      color: null,
      status: "published",
      providerId: "codex",
      model: "gpt-5.5",
      reasoningLevel: null,
      projectId: null,
      defaultUserMessage: "",
      prompts: [{ type: "text", text: PROMPT_TEXT }],
    };

    // Two personas named Pirate in ONE file, on top of the existing one.
    const result = (await host.harness.behavior.callRpc("importPersonas", {
      personas: [filePersona, { ...filePersona, emoji: "🐙" }],
    })) as { imported: number };

    expect(result.imported).toBe(2);
    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ name: string; emoji: string }> };
    const names = personas.map((p) => p.name).sort();
    expect(names).toEqual(["Pirate", "Pirate (NEW-IMPORT)", "Pirate (NEW-IMPORT-2)"]);
  });

  it("skips one invalid persona without aborting the batch", async () => {
    const result = (await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          name: "Broken",
          emoji: "💥",
          color: null,
          status: "live",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [],
        },
        {
          format: "bb-plugin-personas/v1",
          name: "Fine",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [],
        },
      ],
    })) as { imported: number; skipped: number; errors: Array<{ index: number }> };

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]!.index).toBe(0);
  });

  it("lands a persona with no provider or model as a draft", async () => {
    const result = (await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          format: "bb-plugin-personas/v1",
          name: "Headless",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "",
          model: "",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [],
        },
      ],
    })) as { imported: number };

    expect(result.imported).toBe(1);
    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ name: string; status: string }> };
    expect(personas[0]).toMatchObject({ name: "Headless", status: "draft" });
  });

  it("re-attaches note prompts when the note exists here and degrades to text when it doesn't", async () => {
    const notes = stubCrossPluginRpc({
      "floating-notes:listNotes": () => ({
        notes: [makeFloatingNote({ id: "note_1", body: "Fresh note body." })],
      }),
    });

    await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          format: "bb-plugin-personas/v1",
          name: "Re-linked",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [{ type: "note", text: "Stale snapshot.", noteId: "note_1" }],
        },
        {
          format: "bb-plugin-personas/v1",
          name: "Degraded",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [{ type: "note", text: "Stale snapshot.", noteId: "note_gone" }],
        },
      ],
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ name: string; prompts: Array<{ type: string; text: string }> }> };
    const byName = new Map(personas.map((p) => [p.name, p]));
    expect(byName.get("Re-linked")!.prompts).toMatchObject([
      { type: "note", text: "Fresh note body.", noteId: "note_1" },
    ]);
    expect(byName.get("Degraded")!.prompts).toMatchObject([
      { type: "text", text: "Stale snapshot." },
    ]);
    // One note listing served the whole batch.
    expect(notes).toHaveLength(1);
  });

  it("re-attaches doc prompts whose file reads here and degrades to text when it doesn't", async () => {
    const reads = stubCrossPluginRpc({
      "simple-notes:readNote": (input) => {
        const { path } = input as { path: string };
        if (path === "playbooks/pirate.md") {
          return { content: "Fresh file content.", contentEncoding: "utf8" };
        }
        throw new Error(`Path does not exist: ${path}`);
      },
    });

    await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          format: "bb-plugin-personas/v1",
          name: "Re-linked",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [
            {
              type: "doc",
              text: "Stale snapshot.",
              vaultId: "personal",
              path: "playbooks/pirate.md",
            },
          ],
        },
        {
          format: "bb-plugin-personas/v1",
          name: "Degraded",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [
            {
              type: "doc",
              text: "Stale snapshot.",
              vaultId: "personal",
              path: "plans/gone.md",
            },
          ],
        },
      ],
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as {
      personas: Array<{
        name: string;
        prompts: Array<{
          type: string;
          text: string;
          docVaultId?: string;
          docPath?: string;
        }>;
      }>;
    };
    const byName = new Map(personas.map((p) => [p.name, p]));
    expect(byName.get("Re-linked")!.prompts).toMatchObject([
      {
        type: "doc",
        text: "Fresh file content.",
        docVaultId: "personal",
        docPath: "playbooks/pirate.md",
      },
    ]);
    expect(byName.get("Degraded")!.prompts).toMatchObject([
      { type: "text", text: "Stale snapshot." },
    ]);
    // Each distinct file was read once to serve the whole batch (the
    // floating-notes listing the note import path always performs is the
    // third call).
    expect(
      reads.filter((call) => call.method === "readNote"),
    ).toHaveLength(2);
  });

  it("imports doc prompts as verbatim text when Docs isn't available", async () => {
    // No readNote stub and an empty plugin list: nothing is readable here.
    stubCrossPluginRpc({});
    host.harness.inspection.sdk.stub(
      "plugins.list",
      (async () => ({ plugins: [] })) as never,
    );

    await host.harness.behavior.callRpc("importPersonas", {
      personas: [
        {
          format: "bb-plugin-personas/v1",
          name: "Degraded",
          emoji: "🦜",
          color: null,
          status: "published",
          providerId: "codex",
          model: "gpt-5.5",
          reasoningLevel: null,
          projectId: null,
          defaultUserMessage: "",
          prompts: [
            {
              type: "doc",
              text: "Stale snapshot.",
              vaultId: "personal",
              path: "playbooks/pirate.md",
            },
          ],
        },
      ],
    });

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ prompts: Array<{ type: string; text: string }> }> };
    expect(personas[0]!.prompts).toMatchObject([
      { type: "text", text: "Stale snapshot." },
    ]);
  });

  it("round-trips: export → import reproduces names, emoji, color, and prompt order under (NEW-IMPORT)", async () => {
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("savePersona", {
      personaId,
      patch: { color: "cyan", emoji: "🦜" },
    });
    const { personas: exported } = (await host.harness.behavior.callRpc(
      "exportPersonas",
      null,
    )) as { personas: Array<Record<string, unknown>> };

    const result = (await host.harness.behavior.callRpc("importPersonas", {
      personas: exported,
    })) as { imported: number };
    expect(result.imported).toBe(1);

    const { personas } = (await host.harness.behavior.callRpc(
      "listPersonas",
      null,
    )) as { personas: Array<{ name: string; emoji: string; color: string | null; prompts: Array<{ text: string }> }> };
    expect(personas).toHaveLength(2);
    const twin = personas.find((p) => p.name !== "Pirate")!;
    expect(twin).toMatchObject({
      name: "Pirate (NEW-IMPORT)",
      emoji: "🦜",
      color: "cyan",
    });
    expect(twin.prompts.map((p) => p.text)).toEqual([PROMPT_TEXT]);
  });
});
