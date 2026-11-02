// bb-plugin-microsandbox-pi — bridge option parsing.
//
// The bridge child receives everything it needs about the box in one
// env var injected by the server (`contributeEnv`):
//
//   MSP_BRIDGE_OPTS — JSON: image, idleStopSeconds, piHomeMount,
//                     extraMounts[{src,dest,ro?}], secretRoutes
//                     [{env,hosts}] or "ENV@hosts" lines, tlsIntercept,
//                     memorySpec, cpus, piManagedRoot.
//
// Pure here with tests; the msb side lives in boxes.ts/msbbin.ts.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "../lib/paths";

export interface BridgeOptions {
  image: string;
  idleStopSeconds: number;
  piHomeMount: boolean;
  extraMounts: { src: string; dest: string; ro: boolean }[];
  secretRoutes: { env: string; hosts: string[] }[];
  tlsIntercept: boolean;
  piManagedRoot: string;
  memorySpec: string;
  cpus: string;
  /** Extra directories that may hold the msb binary (watcher's setting). */
  msbDirs: string[];
  /** Filesystem path of the pi launcher (e.g. ~/.pi/agent/bin/pi) that
   * drives the in-box `pi --mode rpc` children. Empty = "$HOME/.pi/agent/bin/pi"
   * expanded at box-boot time, falling back to plain "pi" on the box PATH. */
  piLauncher: string;
  /** Trim per-line bridge protocol journal in the plugin data dir. */
  journal: boolean;
}

export interface ParsedSecretRoute {
  env: string;
  hosts: string[];
}

export const DEFAULT_BRIDGE_OPTS: BridgeOptions = {
  image: "node:22-bookworm",
  idleStopSeconds: 30 * 60,
  // pi in-box needs a writable agent dir (settings/schema locks,
  // model-store refreshes), so "mounted" means read-write shared.
  piHomeMount: true,
  extraMounts: [],
  secretRoutes: [
    { env: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] },
    { env: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
    { env: "GEMINI_API_KEY", hosts: ["generativelanguage.googleapis.com"] },
    { env: "OPENCODE_API_KEY", hosts: ["opencode.ai"] },
    { env: "DEEPSEEK_API_KEY", hosts: ["api.deepseek.com"] },
    { env: "CEREBRAS_API_KEY", hosts: ["api.cerebras.ai"] },
    { env: "XAI_API_KEY", hosts: ["api.x.ai"] },
    { env: "MOONSHOT_API_KEY", hosts: ["api.moonshot.cn"] },
    { env: "ZAI_API_KEY", hosts: ["api.z.ai"] },
  ],
  tlsIntercept: true,
  piManagedRoot: "",
  memorySpec: "2G",
  cpus: "2",
  msbDirs: [],
  piLauncher: "",
  journal: false,
};

/** vindicated option envelope: bad JSON → defaults; unknown keys dropped. */
export function parseBridgeOptions(raw: string | undefined): BridgeOptions {
  if (raw === undefined || raw.trim() === "") return { ...DEFAULT_BRIDGE_OPTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_BRIDGE_OPTS };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_BRIDGE_OPTS };
  const input = parsed as Record<string, unknown>;
  const extraMounts = Array.isArray(input.extraMounts)
    ? input.extraMounts.flatMap((row): { src: string; dest: string; ro: boolean }[] => {
        if (typeof row === "object" && row !== null) {
          const spec = row as Record<string, unknown>;
          if (typeof spec.src === "string" && typeof spec.dest === "string") {
            return [{ src: expandHome(spec.src, homedir()), dest: expandHome(spec.dest, homedir()), ro: spec.ro === true }];
          }
        }
        return [];
      })
    : [];
  const secretRoutes = Array.isArray(input.secretRoutes)
    ? input.secretRoutes.flatMap((row): { env: string; hosts: string[] }[] => {
        if (typeof row === "string") {
          const [env, hosts] = row.split("@");
          if (env && hosts) return [{ env: env.trim(), hosts: hosts.split(",").map((h) => h.trim()).filter(Boolean) }];
        }
        if (typeof row === "object" && row !== null) {
          const spec = row as Record<string, unknown>;
          if (typeof spec.env === "string" && Array.isArray(spec.hosts)) {
            return [{ env: spec.env, hosts: spec.hosts.filter((h): h is string => typeof h === "string" && h !== "") }];
          }
        }
        return [];
      })
    : [];
  const number = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    image: typeof input.image === "string" && input.image.trim() ? input.image : DEFAULT_BRIDGE_OPTS.image,
    idleStopSeconds: number(input.idleStopSeconds, DEFAULT_BRIDGE_OPTS.idleStopSeconds),
    piHomeMount: input.piHomeMount === false ? false : DEFAULT_BRIDGE_OPTS.piHomeMount,
    extraMounts,
    secretRoutes,
    tlsIntercept: input.tlsIntercept === false ? false : DEFAULT_BRIDGE_OPTS.tlsIntercept,
    piManagedRoot: typeof input.piManagedRoot === "string" ? input.piManagedRoot : "",
    memorySpec: typeof input.memorySpec === "string" && input.memorySpec ? input.memorySpec : DEFAULT_BRIDGE_OPTS.memorySpec,
    cpus: typeof input.cpus === "string" && input.cpus ? input.cpus : DEFAULT_BRIDGE_OPTS.cpus,
    msbDirs: Array.isArray(input.msbDirs)
      ? input.msbDirs.filter((row): row is string => typeof row === "string" && row.trim() !== "").map((row) => expandHome(row))
      : [],
    piLauncher: typeof input.piLauncher === "string" ? input.piLauncher : "",
    journal: input.journal === true,
  };
}

/** Secrets that both exist in this process env and have configured hosts. */
export function secretsToBind(options: BridgeOptions, env: NodeJS.ProcessEnv): ParsedSecretRoute[] {
  return options.secretRoutes.filter((route) => {
    const value = env[route.env];
    return typeof value === "string" && value.trim() !== "";
  });
}

/** The pi launcher candidate list the box boot prefers in order: the
 * explicit setting first, then the managed-install launcher. */
export function piLauncherCandidates(options: BridgeOptions, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? homedir();
  const set = options.piLauncher.trim();
  if (set !== "") return [expandHome(set, home)];
  return [expandHome("~/.pi/agent/bin/pi", home)];
}

/** Guest env additions. Secrets stay out of the guest: pi sees the
 * literal `$MSB_<NAME>` placeholder that msb replaces at egress. */
export function guestEnvJson(options: BridgeOptions, env: NodeJS.ProcessEnv): Record<string, string> {
  const json: Record<string, string> = {};
  for (const route of secretsToBind(options, env)) {
    json[route.env] = `$MSB_${route.env}`;
  }
  return json;
}

export interface ThreadBoxPlan {
  name: string;
  socketPaths: { in: string; out: string; err: string };
  msbArgs: string[];
  guestEnvFile: string | null;
}

const BOX_PREFIX = "bbp-";
const THREAD_PORTS = { in: 31337, out: 32337, err: 33337 } as const;
const META_PORTS = { in: 35337, out: 36337, err: 37337 } as const;
const META_BOX = "bbp-meta";

export function boxNameForThread(threadId: string): string {
  // Deterministic, msb-name-safe (letters/digits/dash, ≤128 bytes).
  return `${BOX_PREFIX}${sanitizeThreadId(threadId)}`;
}

export function sanitizeThreadId(threadId: string): string {
  return threadId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "anon";
}

export function metaBoxName(): string {
  return META_BOX;
}

/** Full `msb run -d …` argument vector for one box. The command after
 * `--` runs the shim, which execs bb's bridge worker with the provider-pi
 * artifact inside the box. */
export function threadSocketsDir(assetsDir: string, threadId: string): string {
  return join(assetsDir, "boxes", sanitizeThreadId(threadId));
}

export function metaSocketsDir(assetsDir: string): string {
  return join(assetsDir, "boxes", "meta");
}

export const THREAD_BOX_PORTS = THREAD_PORTS;
export const META_BOX_PORTS = META_PORTS;
export const META_BOX_NAME = META_BOX;

/** argv for the one `msb run -d` per box: name, mounts, vsock routes,
 * secrets (host-side binding only), env, then the guest shim command. */
export function buildMsbRunArgs(args: {
  options: BridgeOptions;
  boxName: string;
  socketsDir: string;
  workspaceMount: { src: string; dest: string } | null;
  msbBin: string;
  bridgeBundle: string;
  /** The daemon's bb-provider-bridge-worker.mjs bootstrap (host path). */
  workerPath: string;
  runnerPy: string;
  nodeBin: string;
  envPresent: NodeJS.ProcessEnv;
  envFileMount: { src: string } | null;
  /** Host-side pi session dir, mounted rw so sessions persist across
   * idle-stop/restart of the box. */
  sessionDirMount?: { src: string } | null;
  inBoxPluginId?: string;
  ports?: { in: number; out: number; err: number };
}): string[] {
  const { options, boxName, socketsDir, workspaceMount, msbBin, bridgeBundle, runnerPy, nodeBin } = args;
  const ports = args.ports ?? THREAD_PORTS;
  const argv: string[] = [
    "run",
    "-d",
    "--name",
    boxName,
    "--replace",
    "-q",
    options.image,
  ];
  if (options.piHomeMount) {
    const home = homedir();
    argv.push("--mount-dir", `${expandHome("~/.pi/agent", home)}:${expandHome("~/.pi/agent", home)}:rw`);
  }
  for (const extra of options.extraMounts) {
    argv.push("--mount-dir", `${extra.src}:${extra.dest}${extra.ro ? ":ro" : ""}`);
  }
  if (workspaceMount) argv.push("--mount-dir", `${workspaceMount.src}:${workspaceMount.dest}:rw`);
  if (args.sessionDirMount) argv.push("--mount-dir", `${args.sessionDirMount.src}:${args.sessionDirMount.src}:rw`);
  argv.push("--mount-file", `${bridgeBundle}:/w/provider-pi-host.mjs`);
  argv.push("--mount-file", `${args.workerPath}:/w/bridge-worker.mjs`);
  argv.push("--mount-file", `${runnerPy}:/w/runner.py`);
  if (args.envFileMount) argv.push("--mount-file", `${args.envFileMount.src}:/w/env.json`);
  argv.push("--vsock", `${join(socketsDir, "in.sock")}:${ports.in}`);
  argv.push("--vsock", `${join(socketsDir, "out.sock")}:${ports.out}`);
  argv.push("--vsock", `${join(socketsDir, "err.sock")}:${ports.err}`);
  const secrets = secretsToBind(options, args.envPresent);
  if (options.tlsIntercept && secrets.length > 0) argv.push("--tls-intercept");
  for (const route of secrets) {
    argv.push("--secret", `${route.env}@${route.hosts.join(",")}`);
  }
  argv.push("-e", `HOME=${homedir()}`);
  argv.push("--memory", options.memorySpec, "--cpus", options.cpus);
  argv.push("--idle-timeout", `${options.idleStopSeconds}s`);
  argv.push(
    "--",
    "python3",
    "/w/runner.py",
    String(ports.in),
    String(ports.out),
    String(ports.err),
    "--",
    nodeBin,
    "/w/bridge-worker.mjs",
    "/w/provider-pi-host.mjs",
    args.inBoxPluginId ?? "microsandbox-pi",
    "/w/bridge-data",
  );
  return argv;
}

/** Bridge options live in `<plugin dataDir>/bridge-opts.json`, written by
 * the server entry on load and settings change (the child env carries no
 * plugin options; the dataDir is what the bootstrap passes in). */
export async function loadBridgeOptions(dataDir: string, fallback: BridgeOptions): Promise<BridgeOptions> {
  try {
    const text = await readFile(join(dataDir, "bridge-opts.json"), "utf8");
    const parsed = JSON.parse(text || "");
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseBridgeOptions(JSON.stringify({ ...fallback, ...(parsed as Partial<BridgeOptions>) }));
    }
  } catch {
    /* first boot before the server write, or unreadable: keep fallback */
  }
  return fallback;
}
