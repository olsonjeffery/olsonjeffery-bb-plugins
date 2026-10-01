import { beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
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

// What `experimental_NewThreadComposer` hands back once every selection is
// resolved. `projectId`/`environment` here stand in for "Don't work in a
// project", which the real composer submits as the personal project id plus
// a personal workspace, not null.
function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj_personal",
    providerId: "codex",
    model: "gpt-5.5",
    reasoningLevel: "medium" as const,
    permissionMode: "auto",
    executionInputSources: { providerId: "explicit", model: "explicit" },
    environment: { type: "host", workspace: { type: "personal" } },
    input: [{ type: "text", text: "hi", mentions: [] }],
    ...overrides,
  };
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
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

    const provide = host.harness.registrations.instructionProvider;
    expect(provide).not.toBeNull();

    const forPersona = provide!({ threadId, projectId: "proj_personal" });
    expect(forPersona).toContain("Pirate");
    expect(forPersona).toContain(PROMPT_TEXT);

    // The guard that keeps personas out of every other thread in BB.
    expect(provide!({ threadId: "thr_unrelated", projectId: "p" })).toBeNull();
  });

  it("stops contributing once the persona is deleted", async () => {
    const personaId = await createPublishedPersona();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };
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
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

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
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain(
      "[Floating note is unavailable]",
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
});

describe("startChat", () => {
  it("rejects starting a chat on a draft persona", async () => {
    const { personaId } = (await host.harness.behavior.callRpc(
      "createPersona",
      null,
    )) as { personaId: string };
    await expect(
      host.harness.behavior.callRpc("startChat", {
        personaId,
        request: makeRequest(),
      }),
    ).rejects.toThrow("Publish this persona before starting a chat");
  });

  it("forwards an image-bearing input array to threads.spawn verbatim", async () => {
    const personaId = await createPublishedPersona();
    const input = [
      { type: "text" as const, text: "check this out", mentions: [] },
      { type: "localImage" as const, path: "attachments/shot.png" },
    ];
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest({ input }),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).toMatchObject({ input });
  });

  it("forwards the opaque environment and executionInputSources untouched", async () => {
    const personaId = await createPublishedPersona();
    const environment = { type: "project-default" };
    const executionInputSources = {
      providerId: "explicit" as const,
      model: "client-preference" as const,
    };
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest({
        projectId: "proj_work",
        environment,
        executionInputSources,
      }),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).toMatchObject({
      projectId: "proj_work",
      environment,
      executionInputSources,
    });
  });

  // Regression pin for the reported bug: `title` used to be hardcoded to
  // persona.name, so every chat in the UI was literally named "Builder". BB
  // auto-titles a thread from its first message when title is omitted.
  it("passes no title to threads.spawn, letting BB auto-title the thread", async () => {
    const personaId = await createPublishedPersona();
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).not.toHaveProperty("title");
  });

  it("maps the new thread to the persona so contributeInstructions returns its persona", async () => {
    const personaId = await createPublishedPersona();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

    const provide = host.harness.registrations.instructionProvider!;
    const contributed = provide({ threadId, projectId: "proj_personal" });
    expect(contributed).toContain("Pirate");
    expect(contributed).toContain(PROMPT_TEXT);
  });
});

describe("persistence", () => {
  it("keeps personas, their thread mapping, and their prompt pool across a reload", async () => {
    const personaId = await createPublishedPersona();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

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
    const { threadId } = (await reloaded.harness.behavior.callRpc("startChat", {
      personaId: "persona_prepool",
      request: makeRequest(),
    })) as { threadId: string };
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
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });

    const { chats, archivedChats } = (await host.harness.behavior.callRpc(
      "listChats",
      { personaId },
    )) as { chats: unknown[]; archivedChats: unknown[] };
    expect(chats).toEqual([
      {
        threadId: "thr_1",
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
    // Three real threads get mapped to this persona via startChat (thr_1..thr_3);
    // thr_999 stands in for some other plugin's thread that just happens to
    // come back from threads.list — it must never leak into either bucket.
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });

    host.harness.inspection.sdk.stub(
      "threads.list",
      (async (args?: { archived?: boolean }) => {
        const all = [
          {
            id: "thr_1",
            title: "Active one",
            titleFallback: null,
            status: "idle",
            updatedAt: 20,
            pinnedAt: null,
            archivedAt: null,
          },
          {
            id: "thr_2",
            title: "Archived one",
            titleFallback: null,
            status: "idle",
            updatedAt: 5,
            pinnedAt: null,
            archivedAt: 4,
          },
          {
            id: "thr_999",
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
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });
    await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    });

    host.harness.inspection.sdk.stub(
      "threads.list",
      (async (args?: { archived?: boolean }) => {
        if (args?.archived) return [];
        return [
          {
            id: "thr_1",
            title: "Newest, unpinned",
            titleFallback: null,
            status: "idle",
            updatedAt: 100,
            pinnedAt: null,
            archivedAt: null,
          },
          {
            id: "thr_2",
            title: "Pinned first",
            titleFallback: null,
            status: "idle",
            updatedAt: 10,
            pinnedAt: 50,
            archivedAt: null,
          },
          {
            id: "thr_3",
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
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

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
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      personaId,
      request: makeRequest(),
    })) as { threadId: string };

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
    ]);
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
            source: "path:/home/jeff/src/bb-proj/bb-plugin-personas",
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
      source: "path:/home/jeff/src/bb-proj/bb-plugin-personas",
      managed: false,
      sourceLabel:
        "Local path install — /home/jeff/src/bb-proj/bb-plugin-personas",
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
