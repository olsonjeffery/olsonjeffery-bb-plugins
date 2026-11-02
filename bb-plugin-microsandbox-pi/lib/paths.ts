// bb-plugin-microsandbox-pi — path helpers shared by host-side code.
import { homedir } from "node:os";
import { join } from "node:path";

/** "~"/"~/x" → "$HOME/…"; anything else unchanged. */
export function expandHome(path: string, home: string = homedir()): string {
  const trimmed = path.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(home, trimmed.slice(2));
  return trimmed;
}
