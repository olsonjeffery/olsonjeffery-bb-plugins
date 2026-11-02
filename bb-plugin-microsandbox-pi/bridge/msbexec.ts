// bb-plugin-microsandbox-pi — running the msb CLI from the bridge child.
//
// Thin, runner-injected wrapper so the box lifecycle (boxes.ts) stays
// testable; realRunner is used in production. Also small pure helpers
// for reading `msb list` output.
import { realRunner, type Runner, type RunResult } from "../probe";

export interface MsbExec {
  run(msbBin: string, args: string[], timeoutMs?: number): Promise<RunResult>;
}

export const realMsbExec: MsbExec = {
  async run(msbBin, args, timeoutMs = 30_000) {
    return realRunner(msbBin, args, { timeoutMs });
  },
};

/** Lines of `msb list` output for name lookup; reuse of the probe's
 * table parser keeps one grammar in the plugin. */
export function sandboxNamesFromList(output: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const columns = line.trim().split(/ {2,}/);
    if (columns.length >= 3 && columns[0] !== "NAME") {
      map.set(columns[0], columns[2]);
    }
  }
  return map;
}

export function detachNameFromOutput(output: string): string | null {
  // `msb run -d -q -- …` prints the sandbox name as its last line.
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
}

export type { Runner };
