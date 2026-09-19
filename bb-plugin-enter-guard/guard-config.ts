// Shared module-level config for bb-plugin-enter-guard.
//
// The content script (plain DOM code, no React hooks) and the settings bridge
// banner (a React component mounted in every composer) live in the same bundle,
// so they share this mutable object. The bridge writes the current settings
// here; the content script reads it at keydown time.

export const guardConfig = {
  enabled: true,
  windowMs: 1000,
};

export function parseWindowMs(value: string | boolean | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}
