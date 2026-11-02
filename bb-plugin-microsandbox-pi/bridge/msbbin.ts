// bb-plugin-microsandbox-pi — locating the host-side pieces the bridge
// orchestrates: the msb CLI (box control plane) and — critically — the
// in-box bridge bundle. The in-box child must speak the SAME Provider
// Bridge Protocol dialect as the running bb, so we mount bb's own
// provider-pi artifact (the plugin bridge the daemon actually drives)
// plus THE WORKER bootstrap from this child's own argv, which the
// runner shim execs in-box.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { realRunner, resolveOnPath, resolveExtraBins, type ProbeEnv } from "../probe";

export interface LocatedBins {
  msbBin: string | null;
  /** bb's provider-pi bridge artifact (the in-box child bundle). */
  bridgeBundle: string | null;
  /** The daemon's bb-provider-bridge-worker.mjs bootstrap (nest-bed for the artifact in-box). */
  workerPath: string | null;
}

/** bb's data root: `<root>/plugin-host-artifacts/provider-pi/<slot>/host.mjs`.
 * The bridge child receives its plugin dataDir (`…/.bb/plugins/<id>/bridge-data`);
 * walk up to the level that owns the `plugins` directory, fall back to
 * `~/.bb` when the layout is nonstandard. */
export async function bbDataRoot(dataDir: string): Promise<string> {
  let cursor = dataDir;
  for (let hop = 0; hop < 4; hop += 1) {
    const parent = join(cursor, "..");
    if (parent === "/" || parent === "" || parent === cursor) break;
    cursor = parent;
    try {
      if ((await stat(join(cursor, "plugins"))).isDirectory()) return cursor;
    } catch {
      /* keep walking */
    }
  }
  return join(homedir(), ".bb");
}

export interface BridgeBundleArgs {
  dataDir: string;
  env: NodeJS.ProcessEnv;
}

/** Newest bb provider-pi host.mjs under the bb data root, or env
 * overrides (MSP_PROVIDER_ARTIFACT / MSP_BRIDGE_WORKER) for dev. */

// The in-box child is bb's provider-pi artifact: same protocol dialect
// as the running daemon, whatever version bb is on.
export async function locateBridgeBundle(args: BridgeBundleArgs): Promise<{ bridgeBundle: string | null; workerPath: string | null }> {
  const overrides: { bridgeBundle: string | null; workerPath: string | null } = {
    bridgeBundle: args.env.MSP_PROVIDER_ARTIFACT?.trim() || null,
    workerPath: args.env.MSP_BRIDGE_WORKER?.trim() || null,
  };
  if (overrides.bridgeBundle !== null && overrides.workerPath !== null) return overrides;
  const root = await bbDataRoot(args.dataDir);
  const artifactsDir = join(root, "plugin-host-artifacts", "provider-pi");
  let entries: string[] = [];
  try {
    entries = await readdir(artifactsDir);
  } catch {
    /* no bb artifacts installed yet */
  }
  const candidates: { path: string; mtime: number }[] = [];
  for (const entry of entries) {
    const candidate = join(artifactsDir, entry, "host.mjs");
    try {
      candidates.push({ path: candidate, mtime: (await stat(candidate)).mtimeMs });
    } catch {
      /* other artifact slots */
    }
  }
  const best = candidates.sort((a, b) => b.mtime - a.mtime)[0];
  return {
    bridgeBundle: overrides.bridgeBundle ?? best?.path ?? null,
    workerPath: overrides.workerPath ?? workerFromArgv(),
  };
}

/** This bridge child was spawned BY bb's worker entry; argv[1] is the
 * worker's path (its bootstrap), which is exactly what the in-box shim
 * needs to run the artifact inside the same dialect. */
function workerFromArgv(): string | null {
  const arg = process.argv[1] ?? "";
  return arg.endsWith("bb-provider-bridge-worker.mjs") ? arg : null;
}

/** msb via PATH plus the explicit MSP_MSBDIRS lines (the server forwards
 * the watcher's "Extra msb paths" setting so both live with one list). */
export async function locateMsbBin(
  extraPathLines: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const home = env.HOME ?? homedir();
  const probeEnv: ProbeEnv = { runner: realRunner, pathEnv: env.PATH, home };
  const onPath = await resolveOnPath("msb", env.PATH);
  if (onPath) return onPath;
  const fallbackLines = [
    ...extraPathLines,
    "~/.local/bin",
    "~/.npm-global/bin",
    join(await npmGlobalRoot(env), ".bin"),
    "/usr/local/bin",
  ];
  const extras = await resolveExtraBins("msb", fallbackLines, probeEnv);
  return extras.length > 0 ? extras[0].bin : null;
}

async function npmGlobalRoot(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await realRunner(env.npm_execpath ?? "npm", ["root", "-g"], { timeoutMs: 4_000 });
    const text = (result.stdout || result.stderr).trim().split(/\r?\n/).pop() ?? "";
    if (text && !text.includes(" ")) return text;
  } catch {
    /* npm missing: fall back */
  }
  return join(env.HOME ?? homedir(), ".npm-global", "lib", "node_modules");
}
