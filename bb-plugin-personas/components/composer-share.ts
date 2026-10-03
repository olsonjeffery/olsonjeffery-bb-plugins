// The persona composer and BB's homepage New Thread composer are independent:
// the plugin never writes either draft's live text, so nothing trickles
// between them. What still connects them is handled here:
//
// - Every open of a persona's composer page seeds a FRESH draft slot with the
//   persona's Default User Message — or nothing. The seed travels through the
//   host composer's own `initialPrompt` prop ("only while the draft is still
//   empty": a freshly claimed slot is empty, so it always applies). The
//   persona's own typed work-in-progress never leaves its composer, and the
//   homepage draft is left alone.
//
// - The one-shot homepage handoff: choosing a persona from the homepage
//   launcher captures the homepage composer draft at click time. When it is
//   non-blank, that text is stored here and — read reactively by the persona
//   page — seeds the fresh persona slot instead, with the Default User
//   Message yielding to it (a difference flashes). The persona screen's own
//   list never sets one, so its selections only ever produce empty-or-Default.
//
// The in-composer banner (`ComposerShareBridge` in app.tsx) only turns the
// announced flash into the red prompt-box pulse; no banner ever writes text.

import { useSyncExternalStore } from "react";

export interface ComposerCarry {
  personaId: string;
  text: string;
}

interface ComposerShareState {
  /** The homepage handoff, waiting to be read once. */
  carry: ComposerCarry | null;
  /** True while a persona composer page has its composer open. */
  open: boolean;
  /** Whether the in-composer banner should flash at the open. */
  flash: boolean;
  /** Bumped on every open; the banner reacts to each open exactly once. */
  openToken: number;
}

const state: ComposerShareState = {
  carry: null,
  open: false,
  flash: false,
  openToken: 0,
};

type ShareListener = () => void;
const listeners = new Set<ShareListener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * What a persona composer page seeds at open, given the one-shot homepage
 * carry (null = none) and the persona's Default User Message (""). The
 * carried homepage draft wins over the message; when both are absent the
 * seed is empty. The message's own red-flash rule lives in `flash`: it fires
 * only when a carried draft is in and the message differed — that seed could
 * not apply, and that is the whole signal.
 */
export function resolveComposerOpen({
  carry,
  msg,
}: {
  carry: string | null;
  msg: string;
}): { seedText: string; flash: boolean } {
  if (carry === null || carry.trim().length === 0) {
    return { seedText: msg, flash: false };
  }
  return { seedText: carry, flash: msg.length > 0 && carry !== msg };
}

/** Monotonic per-frontend-session touch, for fresh draft slot names. */
let openSessionVisits = 0;

export const composerShare = {
  get open(): boolean {
    return state.open;
  },
  get openToken(): number {
    return state.openToken;
  },
  get flash(): boolean {
    return state.flash;
  },
  /** A name for a fresh per-visit draft slot that no earlier visit used. */
  claimVisit(): string {
    openSessionVisits += 1;
    return `${openSessionVisits}-${crypto.randomUUID()}`;
  },
  /**
   * Homepage handoff, stored at launcher-click time (the homepage composer
   * draft read as the click happens). Always overwrites the previous carry —
   * the latest selection is the only intent. A blank text still counts as a
   * fresh intent: it reads the same as carrying nothing.
   */
  setHomepageCarry(personaId: string, text: string): void {
    state.carry = { personaId, text };
    emit();
  },
  /** Pure read for React: the carried text for this persona, null otherwise. */
  carryFor(personaId: string): string | null {
    const carry = state.carry;
    return carry !== null && carry.personaId === personaId ? carry.text : null;
  },
  /**
   * The consuming read, once per open: the carried text for this persona, or
   * null. Any open clears the carry — a different persona opening first
   * invalidates the handoff, and the matched one uses it exactly once, so
   * no later visit or homepage change re-seeds old carried text.
   */
  takeCarry(personaId: string): string | null {
    const text = this.carryFor(personaId);
    state.carry = null;
    emit();
    return text;
  },
  /**
   * Announce a composer-page open, exactly once per open (PersonaHome gates
   * on the persona record being loaded). Resolves the open's flash flag; the
   * banner turns it into the prompt-box pulse for each composer it sits in.
   */
  announce(flash: boolean): void {
    state.open = true;
    state.flash = flash;
    state.openToken += 1;
    emit();
  },
  /** A persona composer page unmounting takes the open with it. */
  close(): void {
    state.open = false;
  },
  subscribe(listener: ShareListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset(): void {
    state.carry = null;
    state.open = false;
    state.flash = false;
    state.openToken = 0;
    openSessionVisits = 0;
  },
};

/**
 * Reactive read of the one-shot homepage handoff for a persona's page: the
 * carried homepage draft while one waits for this persona, else null. The
 * persona screen's own selections leave the store untouched, so this reads
 * as null there and the composer opens empty-or-Default.
 */
export function useComposerCarryShare(personaId: string): string | null {
  return useSyncExternalStore(
    composerShare.subscribe,
    () => composerShare.carryFor(personaId),
    () => composerShare.carryFor(personaId),
  );
}
