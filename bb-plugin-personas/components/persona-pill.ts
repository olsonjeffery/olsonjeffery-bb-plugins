// Persona pill draft logic — pure frontend half of the persona inline action.
//
// The pill IS the persona selection on the New Thread composer: the picker
// inserts one @-mention pill owned by this plugin's mention provider, the
// user removes it to disarm (the state never lives anywhere else), and the
// submitted message carries it to the server's dispatch hook, which binds the
// new thread to the persona. Everything here works on a composer draft
// snapshot so it is unit-testable without a host.

import type {
  ComposerDraftSnapshot,
  ComposerDraftReplacement,
  ComposerMention,
} from "@get-bb/plugin-sdk/app";
import { MENTION_PROVIDER_ID } from "@/personas";

/** The plugin's own mention pill item id → persona id. */
export interface PersonaPill {
  itemId: string;
  label: string;
  from: number;
  to: number;
}

/** This composer's persona pills, in draft order. */
export function personaPillsOf(draft: ComposerDraftSnapshot): PersonaPill[] {
  return draft.mentions.flatMap((mention) => {
    if (
      mention.kind !== "plugin" ||
      mention.pluginId !== PLUGIN_ID ||
      mention.provider !== MENTION_PROVIDER_ID
    ) {
      return [];
    }
    return [{ itemId: mention.id, label: mention.label, from: mention.from, to: mention.to }];
  });
}

// The app's own plugin id, as the host assigns it to this package's plugin
// registration. The vendored runtime's experimental_usePluginId() hook returns
// the same value; this constant mirrors it for the pure helpers that have no
// React context.
//
// PLUGIN_ID is also what keeps OTHER plugins' persona alike pills out of
// every computation here — a pill is ours only when both plugin and provider
// equal these constants.
export const PLUGIN_ID = "personas";

function isOurs(mention: ComposerMention): boolean {
  return (
    mention.kind === "plugin" &&
    mention.pluginId === PLUGIN_ID &&
    mention.provider === MENTION_PROVIDER_ID
  );
}

/**
 * What the draft reads with every persona pill's serialized text cut out —
 * how "is there anything besides the chip?" is answered when deciding
 * whether a freshly armed persona may seed its Default User Message.
 */
export function pillAddedText(draft: ComposerDraftSnapshot): string {
  const pills = personaPillsOf(draft);
  if (pills.length === 0) return draft.text;
  let text = "";
  let last = 0;
  for (const pill of [...pills].sort((a, b) => a.from - b.from)) {
    text += draft.text.slice(last, pill.from);
    last = pill.to;
  }
  text += draft.text.slice(last);
  return text;
}

/**
 * The replacement that removes every persona pill from `current`, returning
 * null when there are none (callers skip the write). Kept mentions rebase:
 * their ranges shift by however much pill text sits before them. Mention
 * ranges are non-overlapping (host invariant), so a pill never cuts through
 * a mention that stays.
 */
export function stripPersonaPills(
  current: ComposerDraftSnapshot,
): ComposerDraftReplacement | null {
  const pills = [...personaPillsOf(current)].sort(
    (a, b) => a.from - b.from,
  );
  if (pills.length === 0) return null;

  const removedBefore = (offset: number): number =>
    pills
      .filter((pill) => pill.to <= offset)
      .reduce((sum, pill) => sum + (pill.to - pill.from), 0);

  return {
    text: pillAddedText(current),
    mentions: current.mentions
      .filter((mention) => !isOurs(mention))
      .map((mention) => ({
        ...mention,
        from: mention.from - removedBefore(mention.from),
        to: mention.to - removedBefore(mention.to),
      })),
  };
}
