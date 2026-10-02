// The shared draft bridge between a persona's composer (rendered by
// PersonaHome) and BB's global New Thread composer draft — the input the user
// expects to be one and the same.
//
// The host gives Personas two sanctioned seams:
//
// - Inside the persona's NewThreadComposer subtree (an in-composer banner),
//   `useComposer()`/`useComposerView()` bind to THAT composer's own draft —
//   read and write.
// - Outside it (PersonaHome's panel surface), the same hooks bind to the
//   route draft — BB's global New Thread composer.
//
// This module is the plugin-local store that bridges them: each side reports
// its draft text, and each side adopts the other's non-blank text while the
// persona composer page is open. Reports emit with an origin so neither side
// reacts to the echo of its own write.

export type ComposerShareOrigin = "global" | "persona" | "open";

interface ComposerShareState {
  /** The global New Thread composer draft's text (reported by PersonaHome). */
  globalText: string;
  /** The persona composer draft's text (reported by the in-composer banner). */
  personaText: string;
  /** True while a persona composer page has its composer open. */
  open: boolean;
  /** The open persona's Default User Message; "" = none provided. */
  msg: string;
  /** Bumped on every open; the banner resolves each open exactly once. */
  openToken: number;
}

const state: ComposerShareState = {
  globalText: "",
  personaText: "",
  open: false,
  msg: "",
  openToken: 0,
};

type ShareListener = (origin: ComposerShareOrigin) => void;
const listeners = new Set<ShareListener>();

function emit(origin: ComposerShareOrigin): void {
  for (const listener of [...listeners]) listener(origin);
}

/** Which reported field drove this change; the open push is its own origin. */
function originOf(patch: Partial<ComposerShareState>): ComposerShareOrigin {
  if (patch.globalText !== undefined) return "global";
  if (patch.personaText !== undefined) return "persona";
  return "open";
}

export const composerShare = {
  get globalText(): string {
    return state.globalText;
  },
  get personaText(): string {
    return state.personaText;
  },
  get open(): boolean {
    return state.open;
  },
  get msg(): string {
    return state.msg;
  },
  get openToken(): number {
    return state.openToken;
  },
  set(patch: Partial<ComposerShareState>): void {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (state[key as keyof ComposerShareState] === value) continue;
      state[key as keyof ComposerShareState] = value as never;
      changed = true;
    }
    if (changed) emit(originOf(patch));
  },
  subscribe(listener: ShareListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset(): void {
    state.globalText = "";
    state.personaText = "";
    state.open = false;
    state.msg = "";
    state.openToken = 0;
  },
};

/**
 * What a persona composer should show when its page opens, given the shared
 * draft's text (the global composer), the persona draft it hydrated, and the
 * persona's Default User Message. The user's own text always wins: the shared
 * content is adopted, and the Default User Message is typed only when BOTH
 * sides are blank. When it can't be applied over non-blank text, `flash`
 * alerts the user — the momentary red border, and nothing else.
 */
export function resolveComposerOpen({
  sharedText,
  personaText,
  msg,
}: {
  sharedText: string;
  personaText: string;
  msg: string;
}): { adopt: string | null; flash: boolean } {
  if (sharedText.trim().length > 0) {
    return {
      adopt: sharedText !== personaText ? sharedText : null,
      flash: msg.length > 0 && sharedText !== msg,
    };
  }
  if (msg.length > 0) {
    if (personaText.trim().length === 0) return { adopt: msg, flash: false };
    if (personaText !== msg) return { adopt: null, flash: true };
  }
  return { adopt: null, flash: false };
}
