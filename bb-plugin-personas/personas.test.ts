import { describe, expect, it } from "vitest";
import {
  avatarTint,
  clampPromptText,
  decodeNotePromptRef,
  displayName,
  draftBlockers,
  emojiPickerHint,
  encodeNotePromptRef,
  EMOJI_GROUPS,
  EMOJIS,
  INSTRUCTION_LIMIT,
  isPersonaColor,
  isSingleEmoji,
  joinedPromptText,
  MAX_INSTRUCTIONS,
  MAX_PROMPT_TEXT,
  newPromptId,
  NOTE_UNAVAILABLE_TEXT,
  normalizeEmoji,
  parseRoute,
  personaColorTint,
  PERSONA_COLORS,
  pickEmoji,
  PROMPT_PREVIEW_LIMIT,
  promptPreview,
  previewInstructions,
  REASONING_LEVELS,
  renderPersonaInstructions,
  resolvePromptTexts,
  resolvedPromptText,
  routeToSubPath,
  rowToPersona,
  rowToPrompt,
  sortChats,
  tintFor,
  type Persona,
  type PersonaPrompt,
  type PersonaPromptRow,
  type PersonaRow,
} from "./personas.js";

const persona: Persona = {
  id: "persona_1",
  name: "Pirate",
  emoji: "🏴‍☠️",
  color: null,
  prompts: [
    {
      id: "prompt_1",
      personaId: "persona_1",
      type: "text",
      text: "Always answer in pirate speak.",
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium",
  projectId: null,
  status: "published",
  createdAt: 0,
  updatedAt: 0,
};

describe("parseRoute", () => {
  it("maps every subPath shape", () => {
    expect(parseRoute("")).toEqual({ view: "list" });
    expect(parseRoute("new")).toEqual({ view: "new" });
    expect(parseRoute("persona_1")).toEqual({ view: "persona", personaId: "persona_1" });
    expect(parseRoute("persona_1/edit")).toEqual({ view: "edit", personaId: "persona_1" });
    expect(parseRoute("persona_1/new")).toEqual({
      view: "newChat",
      personaId: "persona_1",
    });
    expect(parseRoute("persona_1/thr_9")).toEqual({
      view: "chat",
      personaId: "persona_1",
      threadId: "thr_9",
    });
  });

  it("tolerates stray slashes", () => {
    expect(parseRoute("/")).toEqual({ view: "list" });
    expect(parseRoute("/persona_1/")).toEqual({ view: "persona", personaId: "persona_1" });
  });

  it("round-trips through routeToSubPath", () => {
    for (const subPath of [
      "",
      "new",
      "persona_1",
      "persona_1/edit",
      "persona_1/new",
      "persona_1/thr_9",
    ]) {
      expect(routeToSubPath(parseRoute(subPath))).toBe(subPath);
    }
  });
});

describe("draftBlockers", () => {
  it("returns [] when name, provider, and model are all present", () => {
    expect(draftBlockers(persona)).toEqual([]);
  });

  it("reports a missing name", () => {
    expect(draftBlockers({ ...persona, name: "  " })).toEqual(["a name"]);
  });

  it("reports a missing provider", () => {
    expect(draftBlockers({ ...persona, providerId: "" })).toEqual(["a provider"]);
  });

  it("reports a missing model", () => {
    expect(draftBlockers({ ...persona, model: "" })).toEqual(["a model"]);
  });

  it("reports every missing field, in name/provider/model order", () => {
    expect(
      draftBlockers({ ...persona, name: "", providerId: "", model: "" }),
    ).toEqual(["a name", "a provider", "a model"]);
  });
});

describe("displayName", () => {
  it("returns the trimmed name when set", () => {
    expect(displayName(persona)).toBe("Pirate");
  });

  it("falls back to a placeholder for a blank name", () => {
    expect(displayName({ ...persona, name: "" })).toBe("Untitled persona");
  });

  it("falls back to a placeholder for a whitespace-only name", () => {
    expect(displayName({ ...persona, name: "   " })).toBe("Untitled persona");
  });
});

describe("renderPersonaInstructions", () => {
  const prompt = (text: string, position: number): PersonaPrompt => ({
    id: `prompt_${position}`,
    personaId: persona.id,
    type: "text",
    text,
    position,
    createdAt: 0,
    updatedAt: 0,
  });

  it("includes the name and every prompt's text", () => {
    const rendered = renderPersonaInstructions({
      ...persona,
      prompts: [prompt("Always answer in pirate speak.", 0), prompt("Never break character.", 1)],
    });
    expect(rendered).toContain("Pirate");
    expect(rendered).toContain("Always answer in pirate speak.");
    expect(rendered).toContain("Never break character.");
  });

  it("stays under BB's instruction limit at maximum single-prompt length", () => {
    const rendered = renderPersonaInstructions({
      ...persona,
      name: "x".repeat(60),
      prompts: [prompt("y".repeat(MAX_PROMPT_TEXT), 0)],
    });
    expect(rendered.length).toBeLessThanOrEqual(INSTRUCTION_LIMIT);
  });

  it("clamps a pool whose joined text exceeds BB's instruction limit", () => {
    const rendered = renderPersonaInstructions({
      ...persona,
      prompts: [
        prompt("y".repeat(MAX_PROMPT_TEXT), 0),
        prompt(`${"z".repeat(MAX_PROMPT_TEXT - 12)}TAIL_MARKER`, 1),
      ],
    });
    expect(rendered.length).toBeLessThanOrEqual(INSTRUCTION_LIMIT);
    // The cut is marked, the wrapper closes cleanly after it, and the
    // second prompt's tail — past the budget — never makes it in.
    expect(rendered).toContain("…");
    expect(rendered.endsWith("</persona-instructions>")).toBe(true);
    expect(rendered).not.toContain("TAIL_MARKER");
  });

  it("renders the wrapper with an empty pool rather than nothing at all", () => {
    const rendered = renderPersonaInstructions({ ...persona, prompts: [] });
    expect(rendered).toContain("Pirate");
    expect(rendered).toContain("<persona-instructions>\n\n</persona-instructions>");
  });
});

describe("previewInstructions", () => {
  it("collapses multi-line input to one line", () => {
    expect(previewInstructions("Always\nanswer\nin pirate speak.")).toBe(
      "Always answer in pirate speak.",
    );
  });

  it("trims leading and trailing whitespace", () => {
    expect(previewInstructions("  Always answer in pirate speak.  \n")).toBe(
      "Always answer in pirate speak.",
    );
  });

  it("returns the fallback for an empty string", () => {
    expect(previewInstructions("")).toBe("No prompts yet.");
  });

  it("returns the fallback for a whitespace-only string", () => {
    expect(previewInstructions("   \n\t  ")).toBe("No prompts yet.");
  });

  it("collapses a markdown heading followed by blank lines", () => {
    expect(previewInstructions("# Pirate\n\n\nAlways answer in pirate speak.")).toBe(
      "# Pirate Always answer in pirate speak.",
    );
  });

  it("passes ordinary single-line text through unchanged", () => {
    expect(previewInstructions("Always answer in pirate speak.")).toBe(
      "Always answer in pirate speak.",
    );
  });
});

describe("pickEmoji", () => {
  it("returns a member of the curated set", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(EMOJIS).toContain(pickEmoji());
    }
  });
});

describe("avatar colors", () => {
  it("wears the chosen color's tint; auto stays on the id-hash tint", () => {
    expect(avatarTint("persona_1", "rose")).toBe(personaColorTint("rose"));
    expect(avatarTint("persona_1", null)).toBe(tintFor("persona_1"));
  });

  it("every palette color has its own theme-aware tint classes", () => {
    for (const candidate of PERSONA_COLORS) {
      const tint = personaColorTint(candidate);
      expect(tint).toContain(`bg-${candidate}-500/15`);
      expect(tint).toContain(`text-${candidate}-600`);
      expect(tint).toContain(`dark:text-${candidate}-400`);
    }
  });

  it("tintFor is stable per persona id and stays inside the palette", () => {
    expect(tintFor("persona_1")).toBe(tintFor("persona_1"));
    expect(tintFor("persona_2")).toBe(tintFor("persona_2"));
    const allTints = PERSONA_COLORS.map((candidate) => personaColorTint(candidate));
    expect(allTints).toContain(tintFor("persona_1"));
  });

  it("isPersonaColor accepts the palette and rejects everything else", () => {
    for (const candidate of PERSONA_COLORS) {
      expect(isPersonaColor(candidate)).toBe(true);
    }
    expect(isPersonaColor("scarlet")).toBe(false);
    expect(isPersonaColor(null)).toBe(false);
    expect(isPersonaColor(42)).toBe(false);
  });
});

describe("EMOJI_GROUPS", () => {
  it("flattens to exactly EMOJIS, in the same order (anti-drift guard)", () => {
    expect(EMOJI_GROUPS.flatMap((group) => group.emojis)).toEqual(EMOJIS);
  });

  it("gives every group a non-empty label and at least one emoji", () => {
    for (const group of EMOJI_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.emojis.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeEmoji", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmoji("  🤖  ")).toBe("🤖");
  });

  it("returns null for an empty string", () => {
    expect(normalizeEmoji("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(normalizeEmoji("   \n\t  ")).toBeNull();
  });

  it("returns null for input longer than 16 characters", () => {
    expect(normalizeEmoji("x".repeat(17))).toBeNull();
  });

  it("accepts input exactly at the 16-character bound", () => {
    const input = "x".repeat(16);
    expect(normalizeEmoji(input)).toBe(input);
  });

  it("accepts a multi-codepoint emoji within the length bound", () => {
    const pirateFlag = "🏴‍☠️";
    expect(pirateFlag.length).toBeLessThanOrEqual(16);
    expect(normalizeEmoji(pirateFlag)).toBe(pirateFlag);
  });
});

describe("isSingleEmoji", () => {
  it("is true for a simple single emoji", () => {
    expect(isSingleEmoji("🤖")).toBe(true);
  });

  it("is true for a multi-codepoint flag sequence", () => {
    expect(isSingleEmoji("🏴‍☠️")).toBe(true);
  });

  it("is true for an emoji with a skin-tone modifier", () => {
    expect(isSingleEmoji("👍🏽")).toBe(true);
  });

  it("is true for a ZWJ-joined profession emoji", () => {
    expect(isSingleEmoji("👩‍💻")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isSingleEmoji("  🤖  ")).toBe(true);
  });

  it("is false for a single non-emoji character, so typing a letter cannot become an icon", () => {
    expect(isSingleEmoji("a")).toBe(false);
    expect(isSingleEmoji("7")).toBe(false);
    expect(isSingleEmoji(".")).toBe(false);
  });

  it("is true for a keycap sequence", () => {
    expect(isSingleEmoji("1️⃣")).toBe(true);
  });

  it("is true for a regional-indicator flag", () => {
    expect(isSingleEmoji("🇺🇸")).toBe(true);
  });

  it("is false for two plain characters", () => {
    expect(isSingleEmoji("ab")).toBe(false);
  });

  it("is false for two separate emoji", () => {
    expect(isSingleEmoji("🤖🤖")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(isSingleEmoji("")).toBe(false);
  });

  it("is false for whitespace-only input", () => {
    expect(isSingleEmoji("  ")).toBe(false);
  });
});

describe("sortChats", () => {
  it("puts pinned chats ahead of unpinned ones regardless of updatedAt", () => {
    const chats = [
      { threadId: "a", pinnedAt: null, updatedAt: 100 },
      { threadId: "b", pinnedAt: 5, updatedAt: 1 },
    ];
    expect(sortChats(chats).map((chat) => chat.threadId)).toEqual(["b", "a"]);
  });

  it("orders multiple pinned chats by pinnedAt descending (most recently pinned first)", () => {
    const chats = [
      { threadId: "a", pinnedAt: 10, updatedAt: 1 },
      { threadId: "b", pinnedAt: 30, updatedAt: 1 },
      { threadId: "c", pinnedAt: 20, updatedAt: 1 },
    ];
    expect(sortChats(chats).map((chat) => chat.threadId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("orders unpinned chats by updatedAt descending", () => {
    const chats = [
      { threadId: "a", pinnedAt: null, updatedAt: 5 },
      { threadId: "b", pinnedAt: null, updatedAt: 15 },
      { threadId: "c", pinnedAt: null, updatedAt: 10 },
    ];
    expect(sortChats(chats).map((chat) => chat.threadId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("does not mutate the input array", () => {
    const chats = [
      { threadId: "a", pinnedAt: null, updatedAt: 1 },
      { threadId: "b", pinnedAt: null, updatedAt: 2 },
    ];
    const original = [...chats];
    sortChats(chats);
    expect(chats).toEqual(original);
  });
});

describe("emojiPickerHint", () => {
  it("prefers the touch hint even when the platform looks like a desktop", () => {
    expect(emojiPickerHint({ platform: "MacIntel", isTouch: true })).toBe(
      "Tap the emoji key on your keyboard",
    );
  });

  it("names the macOS shortcut for MacIntel", () => {
    expect(emojiPickerHint({ platform: "MacIntel", isTouch: false })).toBe(
      "Press ⌃⌘Space for your system emoji picker",
    );
  });

  it("names the macOS shortcut for iPhone", () => {
    expect(emojiPickerHint({ platform: "iPhone", isTouch: false })).toBe(
      "Press ⌃⌘Space for your system emoji picker",
    );
  });

  it("names the Windows shortcut for Win32", () => {
    expect(emojiPickerHint({ platform: "Win32", isTouch: false })).toBe(
      "Press Win + . for your system emoji picker",
    );
  });

  it("falls back to a generic hint for Linux", () => {
    expect(emojiPickerHint({ platform: "Linux x86_64", isTouch: false })).toBe(
      "Use your system emoji picker",
    );
  });
});

describe("rowToPersona", () => {
  const row: PersonaRow = {
    id: "persona_1",
    name: "Pirate",
    emoji: "🏴‍☠️",
    color: null,
    instructions: "Always answer in pirate speak.",
    provider_id: "codex",
    model: "gpt-5.5",
    reasoning_level: "medium",
    project_id: null,
    status: "published",
    created_at: 0,
    updated_at: 0,
  };

  it("keeps a chosen color and reads an unrecognized stored color as auto", () => {
    expect(rowToPersona({ ...row, color: "rose" }, []).color).toBe("rose");
    expect(rowToPersona({ ...row, color: "scarlet" }, []).color).toBeNull();
    expect(rowToPersona({ ...row, color: null }, []).color).toBeNull();
  });

  it("keeps a reasoning level that is in the union", () => {
    expect(REASONING_LEVELS).toContain("medium");
    expect(rowToPersona(row, []).reasoningLevel).toBe("medium");
  });

  it("reads an out-of-union stored reasoning level as unset", () => {
    expect(REASONING_LEVELS).not.toContain("turbo");
    expect(rowToPersona({ ...row, reasoning_level: "turbo" }, []).reasoningLevel).toBeNull();
  });

  it("assigns the given prompt pool by reference so pool writes reach the persona", () => {
    const prompts: PersonaPrompt[] = [];
    expect(rowToPersona(row, prompts).prompts).toBe(prompts);
  });
});

describe("rowToPrompt", () => {
  const row: PersonaPromptRow = {
    id: "prompt_1",
    persona_id: "persona_1",
    type: "text",
    text: "Always answer in pirate speak.",
    position: 3,
    created_at: 5,
    updated_at: 6,
  };

  it("maps the snake_case row onto the prompt shape", () => {
    expect(rowToPrompt(row)).toEqual({
      id: "prompt_1",
      personaId: "persona_1",
      type: "text",
      text: "Always answer in pirate speak.",
      position: 3,
      createdAt: 5,
      updatedAt: 6,
    });
  });

  it("reads any unrecognized stored type as text", () => {
    // A future downgrade must not push an unknown string uncaught into the
    // prompt RPCs' zod schemas.
    expect(rowToPrompt({ ...row, type: "voice" }).type).toBe("text");
  });

  it("reads a note row as a note prompt, keeping the stored reference body", () => {
    const note = rowToPrompt({
      ...row,
      type: "note",
      text: encodeNotePromptRef("note_abc123"),
    });
    expect(note).toMatchObject({ type: "note" });
    expect(decodeNotePromptRef(note.text)).toEqual({
      kind: "floating-note",
      noteId: "note_abc123",
    });
  });

  it("degrades a note row whose body is no longer a decodable reference", () => {
    // Hand-edited or corrupted: reads as an ordinary text prompt so its raw
    // body stays visible and editable instead of crashing the read.
    expect(rowToPrompt({ ...row, type: "note", text: "not a blob" }).type).toBe(
      "text",
    );
  });
});

describe("newPromptId", () => {
  it("uses the prompt_ prefix with a short hex tail", () => {
    expect(newPromptId()).toMatch(/^prompt_[0-9a-f]{16}$/);
  });
});

describe("clampPromptText", () => {
  it("trims surrounding whitespace", () => {
    expect(clampPromptText("  Always answer in pirate speak.  ")).toBe(
      "Always answer in pirate speak.",
    );
  });

  it("slices to MAX_PROMPT_TEXT", () => {
    expect(MAX_PROMPT_TEXT).toBe(MAX_INSTRUCTIONS);
    expect(clampPromptText("y".repeat(MAX_PROMPT_TEXT + 10))).toBe(
      "y".repeat(MAX_PROMPT_TEXT),
    );
  });
});

describe("promptPreview", () => {
  it("passes text at or under the preview limit through unchanged", () => {
    expect(PROMPT_PREVIEW_LIMIT).toBe(50);
    expect(promptPreview("Be terse.")).toBe("Be terse.");
    expect(promptPreview("x".repeat(PROMPT_PREVIEW_LIMIT))).toBe(
      "x".repeat(PROMPT_PREVIEW_LIMIT),
    );
  });

  it("truncates overflow to the first 50 characters plus an ellipsis", () => {
    expect(promptPreview(`${"x".repeat(PROMPT_PREVIEW_LIMIT)}y`)).toBe(
      `${"x".repeat(PROMPT_PREVIEW_LIMIT)}…`,
    );
  });
});

describe("encodeNotePromptRef / decodeNotePromptRef", () => {
  it("round-trips a durable note id", () => {
    expect(decodeNotePromptRef(encodeNotePromptRef("note_abc123"))).toEqual({
      kind: "floating-note",
      noteId: "note_abc123",
    });
  });

  it("rejects ordinary prose, non-JSON, and malformed blobs", () => {
    expect(decodeNotePromptRef("Always answer in pirate speak.")).toBeNull();
    expect(decodeNotePromptRef("not json")).toBeNull();
    expect(decodeNotePromptRef('{"kind":"doc","noteId":"n"}')).toBeNull();
    expect(decodeNotePromptRef('{"kind":"floating-note"}')).toBeNull();
    expect(decodeNotePromptRef('{"kind":"floating-note","noteId":42}')).toBeNull();
    expect(decodeNotePromptRef('{"kind":"floating-note","noteId":""}')).toBeNull();
    expect(decodeNotePromptRef("null")).toBeNull();
  });
});

describe("resolvedPromptText / resolvePromptTexts", () => {
  const bodies = new Map([["note_live", "Feed crackers twice a day."]]);
  const textPrompt = (id: string): PersonaPrompt => ({
    id,
    personaId: "persona_1",
    type: "text",
    text: "Always answer in pirate speak.",
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  });
  const notePrompt = (id: string, noteId: string): PersonaPrompt => ({
    id,
    personaId: "persona_1",
    type: "note",
    text: encodeNotePromptRef(noteId),
    position: 1,
    createdAt: 0,
    updatedAt: 0,
  });

  it("a text prompt is its own text; a note prompt is its note's live body", () => {
    expect(resolvedPromptText(textPrompt("prompt_1"), bodies)).toBe(
      "Always answer in pirate speak.",
    );
    expect(resolvedPromptText(notePrompt("prompt_2", "note_live"), bodies)).toBe(
      "Feed crackers twice a day.",
    );
  });

  it("a note whose body isn't known resolves to the unavailable marker", () => {
    expect(resolvedPromptText(notePrompt("prompt_2", "note_gone"), bodies)).toBe(
      NOTE_UNAVAILABLE_TEXT,
    );
  });

  it("resolvePromptTexts leaves text prompts untouched and only swaps note bodies", () => {
    const resolved = resolvePromptTexts(
      [textPrompt("prompt_1"), notePrompt("prompt_2", "note_live")],
      bodies,
    );
    expect(resolved[0]).toEqual(textPrompt("prompt_1"));
    expect(resolved[1]).toEqual({
      ...notePrompt("prompt_2", "note_live"),
      text: "Feed crackers twice a day.",
    });
  });
});

describe("joinedPromptText", () => {
  const prompt = (id: string, text: string, position: number): PersonaPrompt => ({
    id,
    personaId: "persona_1",
    type: "text",
    text,
    position,
    createdAt: 0,
    updatedAt: 0,
  });

  it("joins prompt texts in pool order with a blank line between them", () => {
    expect(
      joinedPromptText([
        prompt("prompt_1", "Always answer in pirate speak.", 0),
        prompt("prompt_2", "Never break character.", 1),
      ]),
    ).toBe("Always answer in pirate speak.\n\nNever break character.");
  });

  it("skips prompts with empty text", () => {
    expect(
      joinedPromptText([prompt("prompt_1", "", 0), prompt("prompt_2", "Be terse.", 1)]),
    ).toBe("Be terse.");
  });
});
