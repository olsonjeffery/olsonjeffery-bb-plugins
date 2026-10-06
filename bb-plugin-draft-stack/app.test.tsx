// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerCustomization, ExperimentalComposerPopupRegistration } from "@get-bb/plugin-sdk/app";
import type { rpcContract, StackEntry } from "@/server";
import { DraftStackPopup } from "@/components/DraftStackPopup";
import { DraftStackSettings } from "@/components/DraftStackSettings";

const NOW = Date.parse("2026-10-06T12:00:00Z");

function entry(overrides: Partial<StackEntry> & Pick<StackEntry, "id" | "text">): StackEntry {
  return {
    mentions: [],
    attachments: [],
    projectId: null,
    threadId: null,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

const OLDEST = entry({ id: "e1", text: "first draft" });
const MIDDLE = entry({ id: "e2", text: "second draft", projectId: "proj_1", attachments: [{ type: "localImage", name: "shot.png", path: "proj/att/shot.png", sizeBytes: 2048 }] });
const TOP = entry({ id: "e3", text: 'top draft — "quotes" ⚡', mentions: [{ kind: "thread", from: 0, to: 10, label: "thr_1", threadId: "thr_1" }], threadId: "thr_1", projectId: "proj_1" });
const STACK = [OLDEST, MIDDLE, TOP];

const RPC = {
  listStack: () => ({ stack: STACK }),
  pushDraft: (input: unknown) => {
    const draft = input as { text: string; mentions: unknown[]; attachments: unknown[] };
    return { entry: entry({ id: "e_new", text: draft.text }), stack: STACK };
  },
  popDraft: () => ({ entry: TOP }),
  popEntry: ({ entryId }: { entryId: string }) => ({
    entry: STACK.find((candidate) => candidate.id === entryId) ?? null,
  }),
  removeEntry: () => ({ ok: true }),
  moveEntry: () => ({ stack: STACK }),
  clearStack: () => ({ ok: true }),
  rewriteStack: ({ stack: rewritten }: { stack: unknown[] }) => ({ stack: rewritten as StackEntry[] }),
};

async function loadCustomization(): Promise<ComposerCustomization> {
  const app = await loadPluginApp(() => import("./app"));
  const [customization] = app.composerCustomizations;
  expect(customization).toBeDefined();
  return customization!;
}

function loadPopup(): ExperimentalComposerPopupRegistration {
  return (async () => {
    const customization = await loadCustomization();
    const [popup] = customization.experimental_popups ?? [];
    expect(popup).toBeDefined();
    return popup!;
  })();
}

const SDK_FAKE = {
  system: {
    config: async () => ({ appearance: { faviconColor: "pink" } }),
  },
};

describe("draft stack registrations", () => {
  it("registers the composer action, popup, commands, and settings section", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const [customization] = app.composerCustomizations;
    expect(customization?.id).toBe("draft-stack");
    expect(customization?.actions?.map((action) => action.id)).toEqual(["open-selector"]);
    const popup = customization?.experimental_popups?.[0];
    expect(popup?.id).toBe("selector");
    expect(app.settingsSections.map((section) => section.id)).toContain("draft-stack");
  });
});

describe("draft stack selector popup", () => {
  it("lists the stack bottom-first with the highlight starting on the top entry", async () => {
    const popup = await loadPopup();
    const slot = renderSlot(popup, {}, { rpc: RPC, sdk: SDK_FAKE });
    await slot.findByText("first draft");
    expect(slot.getByText('top draft — "quotes" ⚡')).toBeDefined();
    const options = slot.getAllByRole("option");
    expect(options).toHaveLength(3);
    await waitFor(() =>
      expect(options.at(-1)!.getAttribute("aria-selected")).toBe("true"),
    );
    slot.lifecycle.unmount();
  });

  it("moves the highlight with arrow keys and pops the selected entry on Enter", async () => {
    const popup = await loadPopup();
    const slot = renderSlot(popup, {}, { rpc: RPC, sdk: SDK_FAKE });
    await slot.findByText("first draft");
    const listbox = slot.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    await waitFor(() =>
      expect(slot.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true"),
    );
    fireEvent.keyDown(listbox, { key: "Enter" });
    await waitFor(() => {
      const pickCall = slot.inspection.rpcCalls.find((entry_) => entry_.method === "popEntry");
      expect(pickCall).toMatchObject({ input: { entryId: "e2" } });
    });
    slot.lifecycle.unmount();
  });

  it("pushes the composer's draft when Push draft is clicked", async () => {
    const popup = await loadPopup();
    const slot = renderSlot(
      popup,
      {},
      {
        rpc: RPC,
        sdk: SDK_FAKE,
        composer: {
          text: "a fresh draft",
          scope: { kind: "new-thread", projectId: "proj_9" },
        },
      },
    );
    const push = await slot.findByRole("button", { name: "Push current draft onto the stack" });
    expect((push as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(push);
    await waitFor(() => {
      const pushCall = slot.inspection.rpcCalls.find((entry_) => entry_.method === "pushDraft");
      expect(pushCall).toMatchObject({
        input: { text: "a fresh draft", projectId: "proj_9", threadId: null },
      });
    });
    slot.lifecycle.unmount();
  });

  it("disables Push draft while the composer is empty", async () => {
    const popup = await loadPopup();
    const slot = renderSlot(popup, {}, { rpc: RPC, sdk: SDK_FAKE });
    const push = await slot.findByRole("button", { name: "Push current draft onto the stack" });
    expect((push as HTMLButtonElement).disabled).toBe(true);
    slot.lifecycle.unmount();
  });
});

describe("draft stack settings", () => {
  it("lists entries top-first with download links for attachments", async () => {
    const slot = renderSlot({ component: DraftStackSettings }, {}, { rpc: RPC, sdk: SDK_FAKE });
    await slot.findByText("top draft — \"quotes\" ⚡");
    const rows = slot.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("top");
    expect(rows[2].textContent).toContain("first draft");
    const link = slot.getByRole("link", { name: /shot\.png/ });
    expect(link.getAttribute("href")).toBe(
      `/api/v1/projects/${encodeURIComponent(TOP.projectId ?? "")}/attachments/content?path=${encodeURIComponent("proj/att/shot.png")}`,
    );
    slot.lifecycle.unmount();
  });

  it("moves an entry toward the top with the up button", async () => {
    const slot = renderSlot({ component: DraftStackSettings }, {}, { rpc: RPC, sdk: SDK_FAKE });
    await slot.findByText("first draft");
    fireEvent.click(slot.getAllByLabelText("Move entry 3 up (toward the top of the stack)")[0]!);
    await waitFor(() => {
      const moveCall = slot.inspection.rpcCalls.find((entry_) => entry_.method === "moveEntry");
      // e1 is displayed third (stored index 0, the bottom); moving up lands it
      // one position toward the top, at stored index 1.
      expect(moveCall).toMatchObject({ input: { entryId: "e1", toIndex: 1 } });
    });
    slot.lifecycle.unmount();
  });
});
