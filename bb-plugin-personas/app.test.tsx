// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { EMOJIS } from "./personas";

const PERSONA_WITH_CHATS = {
  id: "persona_1",
  name: "Pirate",
  emoji: "🏴‍☠️",
  color: null,
  prompts: [
    {
      id: "prompt_1",
      personaId: "persona_1",
      type: "text" as const,
      text: "Always answer in pirate speak.",
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "published" as const,
  createdAt: 0,
  updatedAt: 100,
};

const PERSONA_NO_CHATS = {
  id: "persona_2",
  name: "Builder",
  emoji: "🤖",
  color: "rose",
  prompts: [
    {
      id: "prompt_2",
      personaId: "persona_2",
      type: "text" as const,
      text: "Fix the persona builder UX. ".repeat(20),
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "published" as const,
  createdAt: 0,
  updatedAt: 50,
};

const PERSONA_DRAFT = {
  id: "persona_3",
  name: "",
  emoji: "🧪",
  color: null,
  prompts: [],
  providerId: "",
  model: "",
  reasoningLevel: null,
  projectId: null,
  status: "draft" as const,
  createdAt: 0,
  updatedAt: 10,
};

const PERSONA_NAMED_DRAFT = {
  id: "persona_4",
  name: "Switcher",
  emoji: "🧪",
  color: null,
  prompts: [],
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "draft" as const,
  createdAt: 0,
  updatedAt: 10,
};

// One published persona whose pool holds a live note prompt: the wire text is
// the note's resolved body (the server resolves it), and noteId is the link.
const PERSONA_WITH_NOTE = {
  id: "persona_5",
  name: "Zookeeper",
  emoji: "🐙",
  color: "violet",
  prompts: [
    {
      id: "prompt_note",
      personaId: "persona_5",
      type: "note" as const,
      text: "Feed crackers twice a day.",
      noteId: "note_2",
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "published" as const,
  createdAt: 0,
  updatedAt: 5,
};

const RAIL_PERSONAS = [
  {
    ...PERSONA_WITH_CHATS,
    chats: [
      { threadId: "thr_new", title: "Ahoy there", status: "active", updatedAt: 200 },
    ],
    lastActivityAt: 200,
  },
  { ...PERSONA_NO_CHATS, chats: [], lastActivityAt: PERSONA_NO_CHATS.updatedAt },
  { ...PERSONA_DRAFT, chats: [], lastActivityAt: PERSONA_DRAFT.updatedAt },
];

const PERSONAS_BY_ID: Record<
  string,
  | typeof PERSONA_WITH_CHATS
  | typeof PERSONA_NO_CHATS
  | typeof PERSONA_DRAFT
  | typeof PERSONA_WITH_NOTE
> = {
  persona_1: PERSONA_WITH_CHATS,
  persona_2: PERSONA_NO_CHATS,
  persona_3: PERSONA_DRAFT,
  persona_5: PERSONA_WITH_NOTE,
};

// The getPluginHealth RPC's self field: where this Personas install came
// from. A git source reads as the managed/official install.
const SELF_MANAGED = {
  version: "1.9.0",
  source: "git:https://github.com/olsonjeffery/bb-plugin-personas.git@semver:^1.9.0",
  managed: true,
  sourceLabel:
    "git:https://github.com/olsonjeffery/bb-plugin-personas.git@semver:^1.9.0",
};

// The local, in-progress path checkout.
const SELF_PATH = {
  version: "1.9.0",
  source: "path:/home/jeff/src/bb-plugin-personas",
  managed: false,
  sourceLabel: "Local path install — /home/jeff/src/bb-plugin-personas",
};

const FLOATING_NOTES_ROW = {
  id: "floating-notes",
  label: "Floating Notes",
  installed: true,
  enabled: true,
  status: "running",
  version: "1.2.1",
  installUrl: null,
  available: true,
};

const FLOATING_NOTES_ROW_MISSING = {
  id: "floating-notes",
  label: "Floating Notes",
  installed: false,
  enabled: false,
  status: null,
  version: null,
  installUrl: "https://github.com/vburojevic/bb-plugin-floating-notes",
  available: false,
};

const FLOATING_NOTES_ROW_DISABLED = {
  id: "floating-notes",
  label: "Floating Notes",
  installed: true,
  enabled: false,
  status: "disabled",
  version: "1.2.1",
  installUrl: null,
  available: false,
};

const HEALTH_AVAILABLE = {
  floatingNotesAvailable: true,
  tools: [FLOATING_NOTES_ROW],
  self: SELF_MANAGED,
};

// Floating Notes missing: "Not installed", the one Install link — and no
// Add-note affordance anywhere in the persona config screen.
const HEALTH_MISSING = {
  floatingNotesAvailable: false,
  tools: [FLOATING_NOTES_ROW_MISSING],
  self: SELF_MANAGED,
};

const HEALTH_DISABLED = {
  floatingNotesAvailable: false,
  tools: [FLOATING_NOTES_ROW_DISABLED],
  self: SELF_MANAGED,
};

// A path install: the settings page must show the in-progress marker.
const HEALTH_PATH_INSTALL = {
  floatingNotesAvailable: true,
  tools: [FLOATING_NOTES_ROW],
  self: SELF_PATH,
};

const FLOATING_NOTES = {
  notes: [
    {
      // persona_1's existing prompt, verbatim: built to collide on attach.
      id: "note_1",
      title: "Pirate sayings",
      body: "Always answer in pirate speak.",
      updatedAt: 20,
    },
    {
      id: "note_2",
      title: "Parrot care",
      body: "Feed crackers twice a day.",
      updatedAt: 10,
    },
  ],
};

const RPC = {
  listRail: () => ({ personas: RAIL_PERSONAS }),
  getPersona: (input: unknown) => {
    const { personaId } = input as { personaId: string };
    return { persona: PERSONAS_BY_ID[personaId] ?? null };
  },
  listChats: (input: unknown) => {
    const { personaId } = input as { personaId: string };
    if (personaId === "persona_1") {
      return {
        chats: [
          {
            threadId: "thr_new",
            title: "Ahoy there",
            status: "active",
            updatedAt: 200,
            pinnedAt: null,
            archivedAt: null,
          },
        ],
        archivedChats: [],
      };
    }
    return { chats: [], archivedChats: [] };
  },
  unarchiveChat: () => ({ ok: true }),
  listOptions: () => ({
    providers: [{ id: "codex", displayName: "Codex", available: true }],
    projects: [{ id: "proj_work", name: "Work" }],
    personalProjectId: "proj_personal",
  }),
  listModels: () => ({
    models: [
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "",
        isDefault: true,
        defaultReasoningEffort: "medium" as const,
        reasoningEfforts: ["medium" as const],
      },
    ],
  }),
  startChat: () => ({ threadId: "thr_from_home" }),
  createPersona: () => ({ personaId: "persona_new" }),
  savePersona: () => ({ ok: true }),
  addPersonaPrompt: () => ({
    prompt: {
      id: "prompt_added",
      personaId: "persona_1",
      type: "text",
      text: "Never break character.",
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  }),
  updatePersonaPrompt: () => ({ prompt: PERSONA_WITH_CHATS.prompts[0] }),
  removePersonaPrompt: () => ({ ok: true }),
  publishPersona: () => ({ ok: true }),
  deletePersona: () => ({ ok: true }),
  getPluginHealth: () => HEALTH_AVAILABLE,
  listFloatingNotes: () => FLOATING_NOTES,
};

async function loadPanel() {
  const app = await loadPluginApp(() => import("./app"));
  const [panel] = app.navPanels;
  expect(panel).toBeDefined();
  return panel!;
}

describe("personas nav panel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers one panel at the personas path", async () => {
    const panel = await loadPanel();
    expect(panel.id).toBe("personas");
    expect(panel.path).toBe("personas");
    expect(panel.title).toBe("Personas");
  });

  it("renders the rail with personas, marking drafts with a DRAFT badge", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    await slot.findByText("Pirate");
    await slot.findByText("Builder");
    await slot.findByText("DRAFT");
    slot.lifecycle.unmount();
  });

  it("navigates to a persona when its rail row is clicked", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    (await slot.findByText("Builder")).click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "personas",
      options: { subPath: "persona_2" },
    });
    slot.lifecycle.unmount();
  });

  it("creates a persona from the rail's new-persona button and routes to its editor", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    (await slot.findByLabelText("New persona")).click();

    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "personas",
        options: { subPath: "persona_new/edit" },
      }),
    );
    const createCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "createPersona",
    );
    expect(createCall?.input).toBeNull();
    slot.lifecycle.unmount();
  });

  it("lands the persona detail view in the live editor with no redirect", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1" }, { rpc: RPC });

    await slot.findByText("Live edit");
    expect(slot.inspection.navigateCalls).toEqual([]);
    slot.lifecycle.unmount();
  });

  it("renders the composer and chat list on the persona's new-chat page", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: RPC });

    await slot.findByTestId("bb-new-thread-composer");
    await slot.findByText("Chats (1)");
    // "Ahoy there" also appears as the rail row's newest-chat preview, so
    // pick out the one that lives inside the persona page's chat list.
    const chatRowLabel = (await slot.findAllByText("Ahoy there")).find(
      (node) => node.closest("ul.divide-y") !== null,
    );
    expect(chatRowLabel).toBeDefined();
    chatRowLabel!.closest("button")!.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "personas",
      options: { subPath: "persona_1/thr_new" },
    });
    slot.lifecycle.unmount();
  });

  it("keeps the rail flat — no expand toggle and no duplicated nested chat row", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });

    await slot.findByText("Pirate");
    expect(slot.queryByLabelText("Expand chats")).toBeNull();
    expect(slot.queryByLabelText("Collapse chats")).toBeNull();
    // "Ahoy there" is the newest-chat preview on the persona's own row; a nested
    // chat row used to duplicate it directly underneath.
    expect(slot.getAllByText("Ahoy there")).toHaveLength(1);
    slot.lifecycle.unmount();
  });

  // Regression coverage for the shipped bug: the "⋯" trigger had both
  // onClick and onBlur, so moving focus from the trigger to any menu item
  // fired the trigger's blur (closing and unmounting the menu) before the
  // item's own click could land. Every item was dead. This drives the same
  // focus transfer a real mousedown-then-click does — trigger.focus(), then
  // item.focus() (which fires the trigger's blur with relatedTarget set to
  // the item), then item.click() — so it fails under the old handler and
  // passes only because the container-level blur now checks relatedTarget.
  it("fires New chat from the ⋯ menu despite the trigger losing focus to the item", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    menuButton.focus();
    menuButton.click();
    const newChatItem = await slot.findByText("New chat");
    fireEvent.focusOut(menuButton, { relatedTarget: newChatItem });
    expect(newChatItem.isConnected).toBe(true);
    newChatItem.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "personas",
      options: { subPath: "persona_2/new" },
    });
    slot.lifecycle.unmount();
  });

  it("opens the ⋯ menu, confirms Delete persona, and calls deletePersona", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    menuButton.focus();
    menuButton.click();
    const deleteItem = await slot.findByText("Delete persona");

    // The bug this pins: focus leaves the trigger for the menu item on
    // mousedown, and the old handler closed the menu right then — unmounting
    // the item before its click could land. jsdom's .focus() alone doesn't
    // reproduce that, so dispatch the focusout React actually listens for and
    // assert the item SURVIVES it before clicking.
    fireEvent.focusOut(menuButton, { relatedTarget: deleteItem });
    expect(deleteItem.isConnected).toBe(true);
    deleteItem.click();

    await slot.findByText("Delete Builder?");
    (await slot.findByRole("button", { name: "Delete" })).click();

    await waitFor(() => {
      const deleteCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "deletePersona",
      );
      expect(deleteCall?.input).toEqual({ personaId: "persona_2" });
    });
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "personas",
        options: { subPath: "", replace: true },
      }),
    );
    slot.lifecycle.unmount();
  });

  it("clamps instructions with a working Show more / Show less toggle", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    const showMore = await slot.findByRole("button", { name: "Show more" });
    showMore.click();
    await slot.findByRole("button", { name: "Show less" });
    slot.lifecycle.unmount();
  });

  it("renders the header subtitle only when the persona has provider, model, or reasoning to show", async () => {
    const panel = await loadPanel();
    const configured = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });
    const configuredHeader = (await configured.findByLabelText("More actions"))
      .closest("div.relative")!.parentElement!;
    expect(configuredHeader.textContent).toContain("codex · gpt-5.5 · medium");
    configured.lifecycle.unmount();

    // persona_3 is a draft with an empty providerId, an empty model, and a null
    // reasoningLevel, so the joined subtitle must collapse away entirely
    // rather than rendering the separators around missing parts.
    const draft = renderSlot(panel, { subPath: "persona_3/new" }, { rpc: RPC });
    const draftHeader = (await draft.findByLabelText("More actions"))
      .closest("div.relative")!.parentElement!;
    expect(draftHeader.textContent).not.toContain("·");
    draft.lifecycle.unmount();
  });

  it("shows no gear/settings button anywhere on the persona header", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    await slot.findByLabelText("More actions");
    expect(slot.queryByLabelText("Edit persona settings")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("exposes the ⋯ menu as an ARIA menu, with aria-expanded tracking open state", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByRole("menu")).toBeNull();

    menuButton.click();

    await slot.findByRole("menu");
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["New chat", "Delete persona"]);

    slot.lifecycle.unmount();
  });

  it("confirms before deleting a draft from the editor", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_3/edit" }, { rpc: RPC });

    (await slot.findByText("Delete draft")).click();
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "deletePersona"),
    ).toBe(false);

    await slot.findByText("Delete Untitled persona?");
    (await slot.findByRole("button", { name: "Cancel" })).click();
    await waitFor(() =>
      expect(slot.queryByText("Delete Untitled persona?")).toBeNull(),
    );
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "deletePersona"),
    ).toBe(false);

    (await slot.findByText("Delete draft")).click();
    await slot.findByText("Delete Untitled persona?");
    (await slot.findByRole("button", { name: "Delete" })).click();

    await waitFor(() => {
      const deleteCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "deletePersona",
      );
      expect(deleteCall?.input).toEqual({ personaId: "persona_3" });
    });
    slot.lifecycle.unmount();
  });

  // -- Prompt pool editor ------------------------------------------------------

  it("renders each pool entry as a 50-character preview with an overflow ellipsis", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/edit" }, { rpc: RPC });

    // persona_2's prompt is 840 characters, so the entry shows exactly its
    // first 50 plus an ellipsis — never the whole text.
    await slot.findByLabelText("Text prompt");
    expect(slot.queryByText("No prompts yet — add one below.")).toBeNull();
    await slot.findByText(`${PERSONA_NO_CHATS.prompts[0]!.text.slice(0, 50)}…`);
    expect(slot.queryByText(PERSONA_NO_CHATS.prompts[0]!.text)).toBeNull();

    slot.lifecycle.unmount();
  });

  it("shows the empty-pool hint and a disabled + Add for a persona with no prompts", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_3/edit" }, { rpc: RPC });

    await slot.findByText("No prompts yet — add one below.");
    expect(
      (slot.getByRole("button", { name: "+ Add" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    slot.lifecycle.unmount();
  });

  it("adds a text prompt from the textarea and + Add button", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_3/edit" }, { rpc: RPC });

    const textarea = await slot.findByLabelText("Text prompt");
    fireEvent.change(textarea, { target: { value: "Never break character." } });
    (await slot.findByRole("button", { name: "+ Add" })).click();

    await waitFor(() => {
      const addCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "addPersonaPrompt",
      );
      expect(addCall?.input).toEqual({
        personaId: "persona_3",
        type: "text",
        text: "Never break character.",
      });
    });
    // The form resets after a successful add.
    await waitFor(() =>
      expect(
        (slot.getByLabelText("Text prompt") as HTMLTextAreaElement).value,
      ).toBe(""),
    );

    slot.lifecycle.unmount();
  });

  it("allows a prompt whose first characters match an existing entry — the user curates the pool", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    // persona_1 already holds "Always answer in pirate speak."; duplicates
    // are the user's call now, so the add goes straight through.
    const textarea = await slot.findByLabelText("Text prompt");
    fireEvent.change(textarea, {
      target: { value: "Always answer in pirate XX" },
    });
    (await slot.findByRole("button", { name: "+ Add" })).click();

    await waitFor(() => {
      const addCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "addPersonaPrompt",
      );
      expect(addCall?.input).toEqual({
        personaId: "persona_1",
        type: "text",
        text: "Always answer in pirate XX",
      });
    });
    // The form resets after a successful add.
    await waitFor(() =>
      expect(
        (slot.getByLabelText("Text prompt") as HTMLTextAreaElement).value,
      ).toBe(""),
    );

    slot.lifecycle.unmount();
  });

  it("edits an existing prompt in place and cancels out of the edit", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    (await slot.findByRole("button", { name: "Edit prompt: Always answer in pirate speak." })).click();

    // The textarea loads the prompt's full text for editing.
    const textarea = (await slot.findByLabelText(
      "Text prompt",
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Always answer in pirate speak.");
    fireEvent.change(textarea, { target: { value: "Answer as a parrot instead." } });

    (await slot.findByRole("button", { name: "Save prompt" })).click();
    await waitFor(() => {
      const updateCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "updatePersonaPrompt",
      );
      expect(updateCall?.input).toEqual({
        personaId: "persona_1",
        promptId: "prompt_1",
        text: "Answer as a parrot instead.",
      });
    });

    slot.lifecycle.unmount();
  });

  it("removes a prompt from the pool", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    (await slot.findByRole("button", { name: "Remove prompt: Always answer in pirate speak." })).click();

    await waitFor(() => {
      const removeCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "removePersonaPrompt",
      );
      expect(removeCall?.input).toEqual({
        personaId: "persona_1",
        promptId: "prompt_1",
      });
    });

    slot.lifecycle.unmount();
  });

  it("offers Add Floating Note only while Floating Notes is available", async () => {
    const panel = await loadPanel();

    // Floating Notes healthy: the dropdown offers the note picker.
    const both = renderSlot(panel, { subPath: "persona_3/edit" }, { rpc: RPC });
    fireEvent.click(
      await both.findByRole("button", { name: "More add options" }),
    );
    await both.findByRole("menuitem", { name: "Add Floating Note" });
    both.lifecycle.unmount();

    // Floating Notes missing: no dropdown at all — the config screen offers
    // no Add-note affordance, just the plain typed-text + Add button.
    const none = renderSlot(
      panel,
      { subPath: "persona_3/edit" },
      { rpc: { ...RPC, getPluginHealth: () => HEALTH_MISSING } },
    );
    await none.findByText("No prompts yet — add one below.");
    expect(none.queryByRole("button", { name: "More add options" })).toBeNull();
    expect(none.queryByRole("menuitem", { name: "Add Floating Note" })).toBeNull();
    expect(none.queryByRole("button", { name: "+ Add" })).not.toBeNull();
    none.lifecycle.unmount();
  });

  it("attaches a Floating Note from the picker as a live note reference, with inline search filtering", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_3/edit" }, { rpc: RPC });

    fireEvent.click(
      await slot.findByRole("button", { name: "More add options" }),
    );
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Add Floating Note" }),
    );

    // The picker lists every note; typing filters the list inline.
    await slot.findByText("Pirate sayings");
    await slot.findByText("Parrot care");
    fireEvent.change(slot.getByLabelText("Search notes"), {
      target: { value: "parrot" },
    });
    expect(slot.queryByText("Pirate sayings")).toBeNull();
    fireEvent.click(await slot.findByRole("button", { name: /Parrot care/ }));

    // Selecting the note dismissed the modal and attached the note BY ID —
    // a live reference, not a copy of the note's current text.
    await waitFor(() => {
      const addCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "addPersonaPrompt",
      );
      expect(addCall?.input).toEqual({
        personaId: "persona_3",
        type: "note",
        noteId: "note_2",
      });
    });
    expect(
      slot.queryByText("Pick one note to add to this persona's prompt pool."),
    ).toBeNull();

    slot.lifecycle.unmount();
  });

  it("attaches a note whose body matches an existing prompt — duplicates are the user's call now", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    fireEvent.click(
      await slot.findByRole("button", { name: "More add options" }),
    );
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Add Floating Note" }),
    );

    // note_1's body is persona_1's existing prompt, verbatim — allowed.
    fireEvent.click(await slot.findByRole("button", { name: /Pirate sayings/ }));

    await waitFor(() => {
      const addCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "addPersonaPrompt",
      );
      expect(addCall?.input).toEqual({
        personaId: "persona_1",
        type: "note",
        noteId: "note_1",
      });
    });
    expect(
      slot.queryByText("Pick one note to add to this persona's prompt pool."),
    ).toBeNull();

    slot.lifecycle.unmount();
  });

  it("renders a note entry as a live Floating Note: badged, never editable, only removable", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_5/edit" }, { rpc: RPC });

    // The wire already resolved the note's live body for the entry display.
    await slot.findByText("Floating Note");
    await slot.findByText("Feed crackers twice a day.");
    // Not editable: no Edit affordance exists for the note entry.
    expect(slot.queryByRole("button", { name: /^Edit/ })).toBeNull();

    (await slot.findByRole("button", { name: "Remove prompt: Feed crackers twice a day." })).click();
    await waitFor(() => {
      const removeCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "removePersonaPrompt",
      );
      expect(removeCall?.input).toEqual({
        personaId: "persona_5",
        promptId: "prompt_note",
      });
    });

    slot.lifecycle.unmount();
  });

  it("clears the model and keeps Publish disabled when the picked provider has no models", async () => {
    // Radix's Select needs these; jsdom ships neither.
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};

    const panel = await loadPanel();
    const slot = renderSlot(
      panel,
      { subPath: "persona_4/edit" },
      {
        rpc: {
          ...RPC,
          getPersona: () => ({ persona: PERSONA_NAMED_DRAFT }),
          listOptions: () => ({
            providers: [
              { id: "codex", displayName: "Codex", available: true },
              { id: "vacant", displayName: "Vacant", available: true },
            ],
            projects: [],
            personalProjectId: null,
          }),
          // Settled-and-empty, not pending: the editor must tell "this
          // provider offers nothing" apart from "still loading".
          listModels: (input: unknown) => {
            const { providerId } = input as { providerId: string };
            if (providerId === "vacant") return { models: [] };
            return RPC.listModels();
          },
        },
      },
    );

    const providerTrigger = await slot.findByLabelText("Provider");
    providerTrigger.focus();
    fireEvent.keyDown(providerTrigger, { key: "ArrowDown" });
    fireEvent.click(await slot.findByText("Vacant"));

    await waitFor(() =>
      expect(slot.getByLabelText("Model").textContent).toBe("Select a model"),
    );
    expect(
      slot.getByText("Publish persona").closest("button")!.disabled,
    ).toBe(true);

    slot.lifecycle.unmount();
  });

  it("shows a setup callout instead of a composer for a draft persona", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_3/new" }, { rpc: RPC });

    await slot.findByText("Finish setting up this persona");
    await slot.findByText("Set up →");
    expect(slot.queryByTestId("bb-new-thread-composer")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("seeds the host new-thread composer and starts a chat from PersonaHome", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/new" }, { rpc: RPC });

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.getAttribute("data-default-provider-id")).toBe("codex");
    expect(composer.getAttribute("data-default-model")).toBe("gpt-5.5");
    expect(composer.getAttribute("data-default-reasoning-level")).toBe(
      "medium",
    );

    (await slot.findByTestId("bb-new-thread-composer-submit")).click();

    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "personas",
        options: { subPath: "persona_2/thr_from_home" },
      }),
    );
    const startChatCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "startChat",
    );
    expect(startChatCall?.input).toMatchObject({
      personaId: "persona_2",
      request: { providerId: "codex", model: "gpt-5.5" },
    });
    slot.lifecycle.unmount();
  });

  it("opens the emoji picker from the avatar and swaps the icon", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    // persona_1's seeded emoji is "🏴‍☠️"; pick a different curated emoji from the
    // grid. "🦉" isn't used by any persona in RAIL_PERSONAS, so it can't collide with
    // an avatar rendered in the rail alongside the editor.
    const trigger = await slot.findByLabelText("Change icon");
    expect(slot.queryByText("Choose an icon")).toBeNull();

    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    const target = slot.getByRole("button", { name: "🦉" });
    fireEvent.click(target);

    // Picking closes the dialog...
    expect(slot.queryByText("Choose an icon")).toBeNull();
    // ...and the avatar now shows the picked emoji.
    expect(slot.getByText("🦉").isConnected).toBe(true);

    slot.lifecycle.unmount();
  });

  it("autosaves a picked emoji as an emoji patch after the debounce", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    const trigger = await slot.findByLabelText("Change icon");
    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    // Install fake timers right before the state change that arms the
    // debounce, so the effect's setTimeout(..., AUTOSAVE_DELAY_MS) call is
    // captured by the fake clock instead of a real one.
    vi.useFakeTimers();
    try {
      const target = slot.getByRole("button", { name: "🦉" });
      fireEvent.click(target);

      await vi.advanceTimersByTimeAsync(600);

      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "savePersona",
      );
      expect(saveCall?.input).toMatchObject({
        personaId: "persona_1",
        patch: { emoji: "🦉" },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("auto-applies a single emoji typed into the custom field without clicking Use, and autosaves it as an emoji patch", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    const trigger = await slot.findByLabelText("Change icon");
    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    vi.useFakeTimers();
    try {
      const customInput = slot.getByLabelText("Any other emoji");
      fireEvent.change(customInput, { target: { value: "🦉" } });

      // Auto-applied immediately — no "Use" click — and the dialog closes.
      expect(slot.queryByText("Choose an icon")).toBeNull();
      expect(slot.getByText("🦉").isConnected).toBe(true);

      await vi.advanceTimersByTimeAsync(600);

      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "savePersona",
      );
      expect(saveCall?.input).toMatchObject({
        personaId: "persona_1",
        patch: { emoji: "🦉" },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("still has a working Shuffle icon button that lands on a curated emoji", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    await slot.findByLabelText("Change icon");
    const shuffle = await slot.findByText("Shuffle icon");
    fireEvent.click(shuffle);

    const avatar = slot.getByLabelText("Change icon").querySelector("span[aria-hidden]");
    expect(avatar).not.toBeNull();
    expect(EMOJIS).toContain(avatar!.textContent);

    slot.lifecycle.unmount();
  });

  it("picks a color from the chooser's palette: the avatar wears it, and it autosaves as a color patch", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/edit" }, { rpc: RPC });

    // persona_1 has no chosen color, so its avatar wears the id-hash tint.
    const trigger = await slot.findByLabelText("Change icon");
    const avatarBefore = trigger.querySelector("span[aria-hidden]")!;
    expect(avatarBefore.className).not.toContain("bg-rose-500/15");

    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    // The palette rides in the chooser: Auto plus the curated colors.
    expect((slot.getByRole("button", { name: "Color: Auto" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");

    // Install fake timers before the state change that arms the debounce,
    // the same seam the emoji autosave test uses.
    vi.useFakeTimers();
    try {
      fireEvent.click(slot.getByRole("button", { name: "Color: Rose" }));

      // Picking a color keeps the chooser open; the avatar already wears it.
      expect(slot.getByText("Choose an icon")).not.toBeNull();
      expect(avatarBefore.className).toContain("bg-rose-500/15");

      await vi.advanceTimersByTimeAsync(600);
      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "savePersona",
      );
      expect(saveCall?.input).toMatchObject({
        personaId: "persona_1",
        patch: { color: "rose" },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("Color: Auto returns the avatar to the hash tint and saves color null", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_2/edit" }, { rpc: RPC });

    // persona_2 ships with rose chosen.
    const trigger = await slot.findByLabelText("Change icon");
    const avatar = trigger.querySelector("span[aria-hidden]")!;
    expect(avatar.className).toContain("bg-rose-500/15");

    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");
    expect(
      (slot.getByRole("button", { name: "Color: Rose" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");

    vi.useFakeTimers();
    try {
      fireEvent.click(slot.getByRole("button", { name: "Color: Auto" }));
      expect(avatar.className).not.toContain("bg-rose-500/15");

      await vi.advanceTimersByTimeAsync(600);
      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "savePersona",
      );
      expect(saveCall?.input).toMatchObject({
        personaId: "persona_2",
        patch: { color: null },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("shows a spinner while a change is persisting, then the saved marker", async () => {
    const panel = await loadPanel();
    let resolveSave: (() => void) | undefined;
    const slot = renderSlot(
      panel,
      { subPath: "persona_1/edit" },
      {
        rpc: {
          ...RPC,
          savePersona: () =>
            new Promise<{ ok: boolean }>((resolve) => {
              resolveSave = () => resolve({ ok: true });
            }),
        },
      },
    );

    const nameInput = await slot.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Renamed" } });

    // The save is in flight: the spinner plus "Saving…" shows, and the
    // saved marker hasn't landed yet.
    await slot.findByText("Saving…", undefined, { timeout: 3000 });
    expect(slot.queryByText("Saved ✓")).toBeNull();
    resolveSave!();

    await slot.findByText("Saved ✓");

    slot.lifecycle.unmount();
  });

  it("the rail's avatars wear each persona's chosen color (and the hash tint when auto)", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });

    await slot.findByText("Pirate");
    await slot.findByText("Builder");

    // Builder chose rose; Pirate is auto — no rose tint on Pirate's avatar.
    const builderAvatar = slot.getByText("Builder").closest("li, div")!.querySelector("span[aria-hidden]");
    expect(builderAvatar).not.toBeNull();
    expect(builderAvatar!.className).toContain("bg-rose-500/15");
    const pirateAvatar = slot.getByText("Pirate").closest("li, div")!.querySelector("span[aria-hidden]");
    expect(pirateAvatar!.className).not.toContain("bg-rose-500/15");

    slot.lifecycle.unmount();
  });

  // -- Chat row menu (pin/rename/archive/delete) and the Archived section --
  //
  // Pin/rename/archive/delete all go through the host's
  // experimental_useSidebarThreadActions() hook, which the test harness
  // stubs and records to slot.inspection.sidebarActionCalls — no vi.mock
  // needed, this is the same seam renderSlot always provides.

  const CHAT_ROW_RPC = {
    ...RPC,
    listChats: (input: unknown) => {
      const { personaId } = input as { personaId: string };
      if (personaId !== "persona_1") return { chats: [], archivedChats: [] };
      return {
        chats: [
          {
            threadId: "thr_new",
            title: "Ahoy there",
            status: "active",
            updatedAt: 200,
            pinnedAt: null,
            archivedAt: null,
          },
        ],
        archivedChats: [
          {
            threadId: "thr_old",
            title: "Buried treasure",
            status: "archived",
            updatedAt: 50,
            pinnedAt: null,
            archivedAt: 60,
          },
        ],
      };
    },
  };

  it("fires Pin from a chat row's ⋯ menu despite the trigger losing focus to the item", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Chats (1)");
    // Two "More actions" triggers exist on this page (the header's and the
    // chat row's); the row's is the last one rendered.
    const menuButtons = await slot.findAllByLabelText("More actions");
    const menuButton = menuButtons[menuButtons.length - 1]!;
    menuButton.focus();
    menuButton.click();
    const pinItem = await slot.findByText("Pin");

    // Same regression as the persona-header menu: the click must survive the
    // trigger's blur firing first.
    fireEvent.focusOut(menuButton, { relatedTarget: pinItem });
    expect(pinItem.isConnected).toBe(true);
    pinItem.click();

    await waitFor(() => {
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "setPinned",
        threadId: "thr_new",
        pinned: true,
      });
    });
    slot.lifecycle.unmount();
  });

  it("renames a chat inline: Enter commits the trimmed title, Escape cancels, and an unchanged/empty value fires nothing", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Chats (1)");
    const menuButtons = await slot.findAllByLabelText("More actions");
    const menuButton = menuButtons[menuButtons.length - 1]!;
    menuButton.focus();
    menuButton.click();
    const renameItem = await slot.findByText("Rename");
    fireEvent.focusOut(menuButton, { relatedTarget: renameItem });
    renameItem.click();

    const input = await slot.findByLabelText("Chat title");

    // Escape cancels — no RPC.
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      slot.inspection.sidebarActionCalls.some((call) => call.method === "rename"),
    ).toBe(false);
    await slot.findByText("Chats (1)");

    // Reopen, clear the title, Enter — empty is a no-op cancel, not a rename.
    const reopened = (await slot.findAllByLabelText("More actions")).at(-1)!;
    reopened.focus();
    reopened.click();
    const renameAgain = await slot.findByText("Rename");
    fireEvent.focusOut(reopened, { relatedTarget: renameAgain });
    renameAgain.click();
    const input2 = await slot.findByLabelText("Chat title");
    fireEvent.change(input2, { target: { value: "   " } });
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(
      slot.inspection.sidebarActionCalls.some((call) => call.method === "rename"),
    ).toBe(false);

    // Reopen, type an actual new title, Enter commits it, trimmed.
    const reopened2 = (await slot.findAllByLabelText("More actions")).at(-1)!;
    reopened2.focus();
    reopened2.click();
    const renameThird = await slot.findByText("Rename");
    fireEvent.focusOut(reopened2, { relatedTarget: renameThird });
    renameThird.click();
    const input3 = await slot.findByLabelText("Chat title");
    fireEvent.change(input3, { target: { value: "  Treasure map  " } });
    fireEvent.keyDown(input3, { key: "Enter" });

    await waitFor(() => {
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "rename",
        threadId: "thr_new",
        title: "Treasure map",
      });
    });
    slot.lifecycle.unmount();
  });

  it("never nests the rename input inside a <button> and hides the navigate button entirely while editing", async () => {
    // Regression test for the disabled-ancestor-makes-descendants-inert bug:
    // an earlier ChatRow put the rename <input> inside a
    // disabled={isEditing} navigate <button>. jsdom doesn't enforce either
    // the invalid-HTML nesting or the real-browser inertness that causes,
    // so this is the assertion that would actually have caught it.
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Chats (1)");
    const menuButton = (await slot.findAllByLabelText("More actions")).at(-1)!;
    menuButton.focus();
    menuButton.click();
    const renameItem = await slot.findByText("Rename");
    fireEvent.focusOut(menuButton, { relatedTarget: renameItem });
    renameItem.click();

    const input = await slot.findByLabelText("Chat title");
    expect(input.closest("button")).toBeNull();

    // The navigate button itself is absent from the editing row — not
    // merely disabled. Its sibling group's row container is the input's
    // parent, and it has no <button> wrapping the title text anymore.
    expect(input.parentElement?.querySelector("button")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    slot.lifecycle.unmount();
  });

  it("calls archive with the chat's threadId from the ⋯ menu", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Chats (1)");
    const menuButton = (await slot.findAllByLabelText("More actions")).at(-1)!;
    menuButton.focus();
    menuButton.click();
    const archiveItem = await slot.findByText("Archive");
    fireEvent.focusOut(menuButton, { relatedTarget: archiveItem });
    expect(archiveItem.isConnected).toBe(true);
    archiveItem.click();

    await waitFor(() => {
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "archive",
        threadId: "thr_new",
      });
    });
    slot.lifecycle.unmount();
  });

  it("calls requestDelete (BB's own confirmation) rather than opening a local dialog", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Chats (1)");
    const menuButton = (await slot.findAllByLabelText("More actions")).at(-1)!;
    menuButton.focus();
    menuButton.click();
    const deleteItem = await slot.findByText("Delete");
    fireEvent.focusOut(menuButton, { relatedTarget: deleteItem });
    expect(deleteItem.isConnected).toBe(true);
    deleteItem.click();

    await waitFor(() => {
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "requestDelete",
        threadId: "thr_new",
      });
    });
    // No local confirmation dialog ever appears for a chat-row delete.
    expect(slot.queryByText("Delete Ahoy there?")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("hides the Archived section when there are no archived chats", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: RPC });

    await slot.findByText("Chats (1)");
    expect(slot.queryByText(/^Archived/)).toBeNull();
    slot.lifecycle.unmount();
  });

  it("renders the Archived section collapsed by default and shows its rows (with Unarchive/Delete only) once expanded", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Archived (1)");
    expect(slot.queryByText("Buried treasure")).toBeNull();

    fireEvent.click(slot.getByText("Archived (1)"));
    await slot.findByText("Buried treasure");

    const menuButtons = await slot.findAllByLabelText("More actions");
    const archivedMenuButton = menuButtons[menuButtons.length - 1]!;
    archivedMenuButton.focus();
    archivedMenuButton.click();

    expect(slot.queryByText("Pin")).toBeNull();
    expect(slot.queryByText("Rename")).toBeNull();
    await slot.findByText("Unarchive");
    await slot.findByText("Delete");

    slot.lifecycle.unmount();
  });

  it("calls the unarchiveChat RPC from an archived row's menu", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "persona_1/new" }, { rpc: CHAT_ROW_RPC });

    await slot.findByText("Archived (1)");
    fireEvent.click(slot.getByText("Archived (1)"));
    await slot.findByText("Buried treasure");

    const menuButton = (await slot.findAllByLabelText("More actions")).at(-1)!;
    menuButton.focus();
    menuButton.click();
    const unarchiveItem = await slot.findByText("Unarchive");
    fireEvent.focusOut(menuButton, { relatedTarget: unarchiveItem });
    expect(unarchiveItem.isConnected).toBe(true);
    unarchiveItem.click();

    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find(
        (call) => call.method === "unarchiveChat",
      );
      expect(call?.input).toEqual({ threadId: "thr_old" });
    });
    slot.lifecycle.unmount();
  });
});

describe("plugin health settings section", () => {
  async function loadSection() {
    const app = await loadPluginApp(() => import("./app"));
    const [section] = app.settingsSections;
    expect(section).toBeDefined();
    return section!;
  }

  it("registers one plugin-health settings section", async () => {
    const section = await loadSection();
    expect(section.id).toBe("plugin-health");
    expect(section.title).toBe("Plugin health");
  });

  it("shows a green check, status, and version for the Floating Notes row when it is installed and enabled", async () => {
    const section = await loadSection();
    const slot = renderSlot(section, {}, { rpc: RPC });

    const row = (await slot.findByText("Floating Notes")).closest("li");
    expect(row).not.toBeNull();
    const icon = row!.querySelector('[aria-label="Installed and enabled"]');
    expect(icon?.getAttribute("class")).toContain("text-emerald-600");
    expect(row!.textContent).toContain("Running · v1.2.1");
    expect(slot.queryByText("Install")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows where this install came from, flagging a local in-progress build", async () => {
    const section = await loadSection();

    // A managed git install: no in-progress marker, raw source on display.
    const managed = renderSlot(section, {}, { rpc: RPC });
    await managed.findByText("Personas · v1.9.0");
    expect(managed.queryByText("Personas · v1.9.0 — in-progress build")).toBeNull();
    managed.lifecycle.unmount();

    // A path install: the in-progress marker and the local label show.
    const local = renderSlot(section, {}, {
      rpc: { ...RPC, getPluginHealth: () => HEALTH_PATH_INSTALL },
    });
    await local.findByText("Personas · v1.9.0 — in-progress build");
    await local.findByText("Local path install — /home/jeff/src/bb-plugin-personas");
    local.lifecycle.unmount();
  });

  it("shows a red X, 'Not installed', and an install link to the bb plugin page when Floating Notes is missing", async () => {
    const section = await loadSection();
    const slot = renderSlot(section, {}, {
      rpc: { ...RPC, getPluginHealth: () => HEALTH_MISSING },
    });

    const icon = await slot.findByLabelText("Not available");
    expect(icon.getAttribute("class")).toContain("text-destructive");
    expect(slot.getByText("Not installed")).toBeTruthy();

    const installLink = slot.getByRole("link", { name: "Install" });
    expect(installLink.getAttribute("href")).toBe(
      "https://github.com/vburojevic/bb-plugin-floating-notes",
    );
    expect(installLink.getAttribute("target")).toBe("_blank");
    slot.lifecycle.unmount();
  });

  it("shows a red X with an enable hint, and no install link, when Floating Notes is installed but disabled", async () => {
    const section = await loadSection();
    const slot = renderSlot(section, {}, {
      rpc: { ...RPC, getPluginHealth: () => HEALTH_DISABLED },
    });

    const icon = await slot.findByLabelText("Not available");
    expect(icon.getAttribute("class")).toContain("text-destructive");
    expect(slot.getByText("Installed — disabled")).toBeTruthy();
    expect(slot.queryByRole("link", { name: "Install" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows the RPC error inline instead of an empty box when the health read fails", async () => {
    const section = await loadSection();
    const slot = renderSlot(section, {}, {
      rpc: {
        ...RPC,
        getPluginHealth: () => {
          throw new Error("plugins.list unavailable");
        },
      },
    });

    await slot.findByText("plugins.list unavailable");
    expect(slot.queryByText("Floating Notes")).toBeNull();
    slot.lifecycle.unmount();
  });
});
