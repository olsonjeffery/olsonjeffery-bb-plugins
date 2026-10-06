// bb-plugin-draft-stack — frontend entry.
//
// Registrations: the Draft Stack composer glyph + inline action and its
// select popup (the DSS), the palette/composer commands, and the stack's
// settings page.
import { definePluginApp, useComposer } from "@get-bb/plugin-sdk/app";
import type { StackEntry } from "@/server";
import { toast } from "sonner";
import { DraftStackGlyph } from "@/components/DraftStackGlyph";
import { DraftStackPopup, POPUP_ID } from "@/components/DraftStackPopup";
import { DraftStackSettings } from "@/components/DraftStackSettings";
import { callRpcOutsideReact } from "@/components/rpc-fetch";

/**
 * The composer's stack inline action: raises the Draft Stack Selector popup
 * above the prompt window. It renders as a native icon button beside the
 * voice/submit actions.
 */
function StackSelectorAction() {
  const composer = useComposer();
  return (
    <button
      type="button"
      aria-label="Draft Stack: open the stack selector"
      title="Draft Stack"
      onClick={() => {
        composer.experimental_openPopup(POPUP_ID);
      }}
      className="inline-flex h-8 items-center justify-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:pointer-coarse:h-10 max-md:pointer-coarse:px-2.5"
    >
      <DraftStackGlyph className="size-4" />
    </button>
  );
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default definePluginApp((app) => {
  // The glyph is this plugin's own icon vocabulary; registering it as an app
  // icon makes "draft-stack/glyph" a normal BbIconName everywhere the plugin
  // draws it.
  app.experimental_icons.register({
    name: "draft-stack/glyph",
    component: DraftStackGlyph,
  });

  app.composer.customize({
    id: "draft-stack",
    actions: [{ id: "open-selector", component: StackSelectorAction }],
    experimental_popups: [
      { id: POPUP_ID, label: "Draft Stack", component: DraftStackPopup },
    ],
  });

  // Composer commands are palette-listed exactly when some composer would
  // run them — the spec's "assuming the User is on a page with a composer".
  app.composer.experimental_registerCommand({
    id: "raise-selector",
    title: "Draft Stack: Raise DSS",
    run: ({ composer }) => {
      composer.experimental_openPopup(POPUP_ID);
    },
  });

  app.composer.experimental_registerCommand({
    id: "push",
    title: "Draft Stack: Push to stack",
    run: async ({ composer }) => {
      if (composer.isEmpty) {
        toast.error("Nothing to push — the draft is empty");
        return;
      }
      try {
        const scope = composer.scope;
        await callRpcOutsideReact("pushDraft", {
          text: composer.draft.text,
          mentions: composer.draft.mentions,
          attachments: composer.draft.attachments,
          projectId: scope.kind === "new-thread" ? scope.projectId : null,
          threadId: scope.kind === "new-thread" ? null : scope.threadId,
        });
        toast.success("Pushed to Draft Stack");
      } catch (cause) {
        toast.error(describeError(cause));
      }
    },
  });

  app.composer.experimental_registerCommand({
    id: "pop",
    title: "Draft Stack: Pop from stack",
    run: async ({ composer }) => {
      try {
        const result = await callRpcOutsideReact<{ entry: StackEntry | null }>(
          "popDraft",
          null,
        );
        if (result.entry === null) {
          toast.error("Draft Stack is empty");
          return;
        }
        const entry = result.entry;
        composer.replace({
          text: entry.text,
          mentions: entry.mentions,
          attachments: entry.attachments,
        });
        composer.focus();
      } catch (cause) {
        toast.error(describeError(cause));
      }
    },
  });

  app.slots.settingsSection({
    id: "draft-stack",
    title: "The stack",
    description:
      "Push drafts from the composer to stack them; picking from the selector pops an entry back into the composer.",
    component: DraftStackSettings,
  });
});
