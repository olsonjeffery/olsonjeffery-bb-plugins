// bb-plugin-microsandbox-pi — the host-side probe.
//
// Runs inside the plugin's bb.host artifact (full-trust Node) and asks
// a machine how its two toolchains are installed. Every failure mode —
// a missing binary, a hung `--version`, an unreadable directory —
// resolves into data on the ToolStatus instead of a throw, because a
// degraded probe is exactly the kind of fact a version watcher is for.
//
// Everything here is dependency-injected (Runner) so tests can stub
// the machine without spawning anything.
import { spawn } from "node:child_process";
import { access, constants as fsConstants, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BoxEntry, BoxesView, MachineSnapshot, SnapshotArgs, ToolStatus } from "./snapshot";
import { compareVersions as cmpVersions, parseVersion, toSemver } from "./lib/versions";

const VERSION_TIMEOUT_MS = 8_000;
const BOXES_TIMEOUT_MS = 10_000;
const CAP_CHARS = 8_192;
const ERROR_CAP_CHARS = 300;

/** msb's npm package is fixed; it's what `npm i microsandbox` installs. */
const MSB_PACKAGE_NAME = "microsandbox";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type Runner = (
  bin: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<RunResult>;

export const realRunner: Runner = (bin, args, opts) =>
  new Promise<RunResult>((done) => {
    const child = spawn(bin, args, {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        stdout: "",
        stderr: `timed out after ${Math.round(opts.timeoutMs / 1000)}s running ${bin}`,
      });
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (cause) => finish({ ok: false, stdout: "", stderr: capError(cause.message) }));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = capText(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = capText(stderr + chunk.toString("utf8"));
    });
    child.on("close", () => finish({ ok: true, stdout, stderr }));
  });

function capText(text: string): string {
  return text.length <= CAP_CHARS ? text : text.slice(0, CAP_CHARS);
}

function capError(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= ERROR_CAP_CHARS ? oneLine : `${oneLine.slice(0, ERROR_CAP_CHARS - 1)}…`;
}

export { parseVersion, toSemver, compareVersions, sortVersionsDesc } from "./lib/versions";

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A tiny `which`: first executable hit across a PATH-style value. */
export async function resolveOnPath(name: string, pathValue: string | undefined): Promise<string | null> {
  if (!pathValue) return null;
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = resolve(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/** "~/nono-lab/…" → "$HOME/nono-lab/…" */
export function expandHome(path: string, home: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(home, trimmed.slice(2));
  return trimmed;
}

export interface ProbeEnv {
  runner: Runner;
  pathEnv: string | undefined;
  home: string;
  /** Environment value of PI_MANAGED_INSTALL_ROOT, if the daemon
   * carried one; injected so probes stay testable. */
  managedRootEnv?: string | undefined;
}

/** Extra candidate lines: a directory (joined with the binary name) or
 * a path ending in the binary name itself. */
async function resolveExtraBins(
  name: string,
  lines: readonly string[],
  env: ProbeEnv,
): Promise<{ bin: string }[]> {
  const found: { bin: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const expanded = expandHome(line, env.home);
    const bin = expanded.endsWith(name) ? expanded : join(expanded, name);
    if (await isExecutable(bin)) found.push({ bin });
  }
  return found;
}

async function askVersion(env: ProbeEnv, bin: string): Promise<{ version: string | null; parseError: string | null }> {
  const result = await env.runner(bin, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS });
  const version = parseVersion(result.stdout) ?? parseVersion(result.stderr);
  if (version) return { version, parseError: null };
  if (!result.ok) return { version: null, parseError: capError(result.stderr || "failed to run") };
  return {
    version: null,
    parseError: `"--version" printed no version${result.stdout.trim() ? ` (${capError(result.stdout)})` : ""}`,
  };
}

interface ManagedRelease {
  version: string;
  dir: string;
}

/** Lists pi's managed install releases, newest first. */
async function readManagedReleases(root: string): Promise<ManagedRelease[]> {
  try {
    const entries = await readdir(join(root, "releases"), { withFileTypes: true });
    const releases: ManagedRelease[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (toSemver(entry.name)) releases.push({ version: entry.name, dir: join(root, "releases", entry.name) });
    }
    releases.sort((a, b) => cmpVersions(b.version, a.version));
    return releases;
  } catch {
    return [];
  }
}

export async function probePi(env: ProbeEnv, managedRootOverride: string): Promise<ToolStatus> {
  const home = env.home;
  const configured = managedRootOverride.trim() || env.managedRootEnv || join(home, ".pi", "agent", "install");
  let root = expandHome(configured, home);
  try {
    root = await realpath(root);
  } catch {
    /* keep the literal root: its absence is data */
  }
  const releases = await readManagedReleases(root);
  const installedVersions = releases.map((release) => release.version);

  let shimReal: string | null = null;
  const shim = join(root, "bin", "pi");
  if (await pathExists(shim)) {
    try {
      shimReal = await realpath(shim);
    } catch {
      /* best effort */
    }
  }
  // pi's standard shim lives in ~/.pi/agent/bin (a wrapper script, not
  // a link into the install tree) — its realpath still means managed.
  const homeShim = join(home, ".pi", "agent", "bin", "pi");
  let homeShimReal: string | null = null;
  if (await pathExists(homeShim)) {
    try {
      homeShimReal = await realpath(homeShim);
    } catch {
      /* best effort */
    }
  }

  const cmdPath = await resolveOnPath("pi", env.pathEnv);
  if (cmdPath) {
    const { version, parseError } = await askVersion(env, cmdPath);
    let binPath = cmdPath;
    try {
      binPath = await realpath(cmdPath);
    } catch {
      /* best effort */
    }
    const managed = binPath.startsWith(root + "/") || binPath === shimReal || binPath === homeShimReal;
    // The shim is a wrapper exec'ing the active release's binary, so a
    // path-prefix match may not find the release dir; the probed
    // version names it exactly, newest release is the fallback.
    const activeDir = managed
      ? releases.find((release) => binPath.startsWith(release.dir + "/"))?.dir ??
        (version ? releases.find((release) => release.version === version)?.dir : undefined) ??
        releases[0]?.dir
      : undefined;
    const packageName = activeDir
      ? await discoverNpmPackageName(activeDir)
      : await discoverNpmPackageName(resolve(dirname(binPath)));
    return {
      version,
      path: binPath,
      origin: managed ? "managed install (PATH shim)" : "PATH",
      detail: `managed root: ${root}${releases.length > 0 ? ` · ${releases.length} release(s)` : ""}`,
      installedVersions: installedVersions.length > 0 ? installedVersions : null,
      error: version ? null : capError(parseError ?? "unknown error"),
      packageName,
    };
  }

  // No PATH entry: the install still counts if its releases are there.
  if (releases.length > 0) {
    const active =
      (shimReal ? releases.find((release) => shimReal.startsWith(release.dir + "/")) : undefined) ?? releases[0];
    const packageName = await discoverNpmPackageName(active.dir);
    return {
      version: active.version,
      path: shimReal ?? active.dir,
      origin: "managed install (no PATH entry)",
      detail: `managed root: ${root} · ${releases.length} release(s)`,
      installedVersions,
      error: null,
      packageName,
    };
  }

  return { version: null, path: null, origin: null, detail: null, installedVersions: null, error: null };
}

/** Which msb binary this machine resolves; shared by the version probe
 * and the in-box `msb list` view. */
export async function resolveMsbBin(
  env: ProbeEnv,
  extraMsbPaths: readonly string[],
): Promise<{ bin: string | null; origin: string | null; extraCount: number }> {
  const extras = await resolveExtraBins("msb", extraMsbPaths, env);
  const onPath = await resolveOnPath("msb", env.pathEnv);
  if (onPath) return { bin: onPath, origin: "PATH", extraCount: extras.length };
  if (extras.length > 0) return { bin: extras[0].bin, origin: "extra path", extraCount: extras.length };
  return { bin: null, origin: null, extraCount: extras.length };
}

/** npm name mapping. For a "private lockfile root" install (pi's managed
 * tree), the package the user cares about is the single dependency —
 * the root's own name is the installer wrapper. */
export async function discoverNpmPackageName(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(dir, "package.json");
    try {
      const { readFile } = await import("node:fs/promises");
      const parsed = JSON.parse(await readFile(manifest, "utf8")) as {
        name?: unknown;
        private?: unknown;
        dependencies?: Record<string, unknown>;
      };
      const deps = parsed.dependencies && typeof parsed.dependencies === "object" ? Object.keys(parsed.dependencies) : [];
      if (parsed.private === true && deps.length === 1) return deps[0];
      if (typeof parsed.name === "string" && parsed.name && !parsed.name.startsWith("?")) return parsed.name;
    } catch {
      /* no manifest here — walk up */
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Parse the `msb list` fixed-width table. Fields are separated by
 * runs of spaces; CREATED keeps its single-space date-time. */
export function parseMsbListTable(output: string): BoxEntry[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  const rows: BoxEntry[] = [];
  for (const line of lines.slice(0, 100)) {
    if (/^NAME\s+IMAGE\s+STATUS/i.test(line)) continue;
    const columns = line.trim().split(/ {2,}/);
    if (columns.length < 2) continue;
    const [name, image, status, createdAt] = [columns[0], columns[1] ?? null, columns[2] ?? "unknown", createdAt0(columns.slice(3))];
    if (!name) continue;
    rows.push({ name, image, status, createdAt });
  }
  return rows;
}

function createdAt0(rest: readonly string[]): string | null {
  return rest.length > 0 ? rest.join(" ") : null;
}

export async function probeMsb(env: ProbeEnv, extraMsbPaths: readonly string[]): Promise<ToolStatus> {
  const { bin, origin, extraCount } = await resolveMsbBin(env, extraMsbPaths);

  const home = env.home;
  const stateDir = join(home, ".msb");
  const hasStateDir = await pathExists(stateDir);

  if (!bin) {
    return {
      version: null,
      path: null,
      origin: null,
      detail: hasStateDir
        ? `no msb binary found, but ~/.msb state dir exists — is it in PATH?`
        : "not found on PATH",
      installedVersions: null,
      error: null,
      packageName: MSB_PACKAGE_NAME,
    };
  }

  const { version, parseError } = await askVersion(env, bin);
  let realBin = bin;
  try {
    realBin = await realpath(bin);
  } catch {
    /* best effort */
  }
  const detailBits = [
    hasStateDir ? "state dir: ~/.msb" : null,
    extraCount > 0 ? `${extraCount} extra path(s) configured` : null,
  ].filter((bit): bit is string => bit !== null);
  return {
    version,
    path: realBin,
    origin,
    detail: detailBits.length > 0 ? detailBits.join(" · ") : null,
    installedVersions: null,
    error: version ? null : capError(parseError ?? "unknown error"),
    packageName: MSB_PACKAGE_NAME,
  };
}

/** The in-box view: the machine's msb runtime inventory (`msb list`),
 * parsed from the fixed-width table the CLI prints. */
export async function probeMsbBoxes(env: ProbeEnv, extraMsbPaths: readonly string[]): Promise<BoxesView> {
  const { bin } = await resolveMsbBin(env, extraMsbPaths);
  if (!bin) return { boxes: null, error: null };
  const result = await env.runner(bin, ["list"], { timeoutMs: BOXES_TIMEOUT_MS });
  const text = (result.stdout || result.stderr).trim();
  if (!result.ok) return { boxes: null, error: capError(result.stderr || "msb list failed") };
  if (!text) return { boxes: [], error: null };
  const rows = parseMsbListTable(text);
  if (rows.length === 0 && !/^NAME\s+IMAGE/i.test(text)) {
    // An unknown surface means the CLI changed shape: keep it visible.
    return { boxes: null, error: capError(`could not read ${text.split(/\r?\n/, 1)[0]}`) };
  }
  return { boxes: rows, error: null };
}

/** Probe every watched toolchain; per-tool failures degrade into a
 * ToolStatus with an error rather than failing the whole snapshot. */
export async function collectSnapshot(args: SnapshotArgs, env: ProbeEnv): Promise<MachineSnapshot> {
  const [pi, msb, boxes] = await Promise.all([
    guard(() => probePi(env, args.piManagedRoot), "pi"),
    guard(() => probeMsb(env, args.extraMsbPaths), "msb"),
    guardBoxes(() => probeMsbBoxes(env, args.extraMsbPaths)),
  ]);
  return {
    checkedAt: Date.now(),
    platform: `${process.platform}/${process.arch}`,
    pi,
    msb,
    boxes,
  };
}

async function guardBoxes(run: () => Promise<BoxesView>): Promise<BoxesView> {
  try {
    return await run();
  } catch (cause) {
    return {
      boxes: null,
      error: capError(cause instanceof Error ? cause.message : String(cause)),
    };
  }
}

async function guard(run: () => Promise<ToolStatus>, tool: "pi" | "msb"): Promise<ToolStatus> {
  try {
    return await run();
  } catch (cause) {
    return {
      version: null,
      path: null,
      origin: null,
      detail: null,
      installedVersions: null,
      error: capError(cause instanceof Error ? cause.message : String(cause)),
    };
  }
}

export const PROBE_TIMEOUT_MS = VERSION_TIMEOUT_MS;
