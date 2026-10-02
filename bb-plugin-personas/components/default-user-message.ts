// Persona composer Default User Message support — the rejection flash.
// Plain DOM, no React: unit-testable against jsdom.

/** The momentary "your draft was not applied" flash class on the prompt box. */
export const DEFAULT_MESSAGE_FLASH_CLASS = "personas-default-message-flash";

/** How long the rejection flash stays on screen before cleaning itself up. */
export const DEFAULT_MESSAGE_FLASH_MS = 1200;

/**
 * One momentary red flash on the prompt box: the persona's Default User
 * Message was not applied because the composer opened already holding
 * work-in-progress text. The flash removes itself when the pulse ends; the
 * returned cleanup cancels the timer and removes the class early.
 */
export function flashPromptBox(target: HTMLElement): () => void {
  target.classList.add(DEFAULT_MESSAGE_FLASH_CLASS);
  const timer = setTimeout(() => {
    target.classList.remove(DEFAULT_MESSAGE_FLASH_CLASS);
  }, DEFAULT_MESSAGE_FLASH_MS);
  return () => {
    clearTimeout(timer);
    target.classList.remove(DEFAULT_MESSAGE_FLASH_CLASS);
  };
}

/**
 * The prompt box this in-composer bridge belongs to. The bridge renders as a
 * bare banner row beside the prompt box inside the composer's shell; fall
 * back to a document-wide lookup only when that structure isn't there (the
 * flash is cosmetic, so a wrong-composer flash is tolerable but rare).
 */
export function promptBoxForBridge(bridge: HTMLElement): HTMLElement | null {
  const shell = bridge.closest<HTMLElement>("[data-promptbox-shell]");
  const box = shell?.querySelector<HTMLElement>("[data-promptbox]") ?? null;
  if (box !== null) return box;
  return bridge.ownerDocument.querySelector<HTMLElement>("[data-promptbox]");
}
