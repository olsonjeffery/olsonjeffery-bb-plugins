// In-bundle channel between the host-rendered palette commands and the
// sidebar. Commands run in the same JS bundle as SpoolerThreadList, so a
// command can hand its intent straight to the sidebar over this window event
// instead of opening a right-hand thread panel.

export type PaletteIntentKind = "move-to-section" | "throw-onto-spool";

export interface PaletteIntent {
  kind: PaletteIntentKind;
  threadId: string;
}

const EVENT = "spools:palette-intent";

/** Pub: invoke from a palette command `run()` to ask the sidebar for a picker. */
export function requestPaletteIntent(intent: PaletteIntent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PaletteIntent>(EVENT, { detail: intent }));
}

/** Sub: returns an unsubscribe function (used by SpoolerThreadList's effect). */
export function onPaletteIntent(
  handler: (intent: PaletteIntent) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PaletteIntent>).detail;
    if (detail && typeof detail === "object" && "kind" in detail) handler(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
