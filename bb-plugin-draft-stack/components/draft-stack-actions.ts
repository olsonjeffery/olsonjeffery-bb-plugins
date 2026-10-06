// Shared Draft Stack actions used by both the composer popup and the
// palette commands: capture the composer's current draft onto the stack,
// and install a stack entry back into the composer.
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import type { DraftStackRpc } from "./use-draft-stack";

/**
 * Pushes the composer's current draft (text, @-mentions, uploaded
 * attachments) onto the top of the stack, stamped with the composer's scope
 * so the settings page can link attachments back to their project.
 */
export async function pushCurrentDraft(
  composer: PluginComposerApi,
  rpc: DraftStackRpc,
): Promise<void> {
  const draft = composer.draft;
  const scope = composer.scope;
  await rpc.call("pushDraft", {
    text: draft.text,
    mentions: [...draft.mentions],
    attachments: [...draft.attachments],
    projectId: scope.kind === "new-thread" ? scope.projectId : null,
    threadId: scope.kind === "new-thread" ? null : scope.threadId,
  });
}

/**
 * Removes one entry from the stack (top when `entryId` is omitted) and
 * installs it into the composer: text and mention pills replaced together,
 * attachments replaced with the saved list. The saved snapshot is restored
 * verbatim, so mention ranges still match the text exactly.
 */
export async function installEntry(
  composer: PluginComposerApi,
  rpc: DraftStackRpc,
  entryId: string | null,
): Promise<void> {
  const result = entryId
    ? await rpc.call("popEntry", { entryId })
    : await rpc.call("popDraft", null);
  const entry = result.entry;
  if (entry === null) {
    throw new Error("Draft Stack is empty");
  }
  composer.replace({
    text: entry.text,
    mentions: entry.mentions,
    attachments: entry.attachments,
  });
  composer.focus();
}
