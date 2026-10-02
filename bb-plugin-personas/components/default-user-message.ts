// Persona composer Default User Message support — the DOM probe and the
// rejection flash. Plain DOM, no React: unit-testable against jsdom.

/** The momentary "your draft was not applied" flash class on the prompt box. */
export const DEFAULT_MESSAGE_FLASH_CLASS = "personas-default-message-flash";

/** How long the rejection flash stays on screen before cleaning itself up. */
export const DEFAULT_MESSAGE_FLASH_MS = 1200;

/**
 * The composer's current draft text, read straight off the DOM: the host's
 * editable prompt-box region when present, else the test harness's textarea.
 * Mention pills contribute their labels, which is the right call — a draft
 * holding only a mention is real content the message could not replace.
 */
export function composerDraftText(root: HTMLElement): string {
  const editor = root.querySelector<HTMLElement>(
    "[data-promptbox-editor-content]",
  );
  if (editor !== null) return editor.textContent ?? "";
  const area = root.querySelector<HTMLTextAreaElement>(
    "textarea[data-testid='bb-new-thread-composer-input']",
  );
  return area?.value ?? "";
}

/**
 * Flashes the composer's text area border red when the composer opened
 * holding work-in-progress text that the persona's Default User Message
 * could not replace. The host seeds the message only while the draft is
 * still empty; the flash is the only other signal that it was not applied —
 * nothing else on screen changes.
 *
 * Returns a cleanup that cancels the flash timer and removes the class, or
 * undefined when there is nothing to flash: the draft is empty (whitespace
 * included), or the text it holds IS the message — the seed that just
 * landed on this very open. (Effects must return undefined, never null.)
 */
export function flashDefaultMessageIfRejected(
  root: HTMLElement,
  message: string,
): (() => void) | undefined {
  const text = composerDraftText(root);
  if (text.trim().length === 0 || text === message) return undefined;
  const editor = root.querySelector<HTMLElement>(
    "[data-promptbox-editor-content]",
  );
  const target =
    (editor?.closest<HTMLElement>("[data-promptbox]") as HTMLElement | null) ??
    root;
  target.classList.add(DEFAULT_MESSAGE_FLASH_CLASS);
  const timer = setTimeout(() => {
    target.classList.remove(DEFAULT_MESSAGE_FLASH_CLASS);
  }, DEFAULT_MESSAGE_FLASH_MS);
  return () => {
    clearTimeout(timer);
    target.classList.remove(DEFAULT_MESSAGE_FLASH_CLASS);
  };
}
