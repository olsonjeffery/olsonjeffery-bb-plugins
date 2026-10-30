// bb-plugin-msb-pi — the host-side probe.
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
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { MachineSnapshot, SnapshotArgs, ToolStatus } from "./snapshot";

const VERSION_TIMEOUT_MS = 8_000;
const CAP_CHARS = 8_192;
const ERROR_CAP_CHARS = 300;

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

/** First semver-ish token in a CLI's version output — "1.3.0" from
 * "pi 1.3.0", "0.7.11" from "msb-cli 0.7.11", prerelease aware. */
export function parseVersion(output: string): string | null {
  // The lookbehind keeps a letter prefix ("v1.3.0") usable but refuses
  // to start mid-run ("x10.1.2") or after a decimal point of a longer
  // undotted run.
  const match = /(?<![\d.])\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z._-]*)?(?:\+[0-9A-Za-z._-]+)?/.exec(output);
  if (!match) return null;
  const after = output.slice(match.index + match[0].length);
  // "1.2.34.56": the greedy number run absorbed a fourth numeric
  // section — refuse rather than misreport a prefix.
  if (/^\.\d/.test(after)) return null;
  return match[0];
}

interface SemverChunks {
  core: [number, number, number];
  pre: readonly (number | string)[];
}

/** One semver for ordering. Loose: accepts a leading "v"/"=" and
 * dotted prerelease identifiers. */
export function toSemver(version: string): SemverChunks | null {
  const match = version
    .replace(/^[v=\s]+/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+.*)?$/);
  if (!match) return null;
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const pre =
    match[4] === undefined ? [] : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { core, pre };
}

/** Semver ordering: pre-release below its release, build metadata
 * ignored. Real semver outranks junk; junk falls back to lexical order,
 * so sorting never throws. */
export function compareVersions(a: string, b: string): number {
  const sa = toSemver(a);
  const sb = toSemver(b);
  if (sa === null && sb === null) return a === b ? 0 : a < b ? -1 : 1;
  if (sa === null) return -1; // junk sorts below real semver
  if (sb === null) return 1;
  {
    for (let i = 0; i < 3; i += 1) {
      if (sa.core[i] !== sb.core[i]) return sa.core[i] - sb.core[i];
    }
    const fa = sa.pre.length === 0;
    const fb = sb.pre.length === 0;
    if (fa !== fb) return fa ? 1 : -1;
    for (let i = 0; i < Math.min(sa.pre.length, sb.pre.length); i += 1) {
      const pa = sa.pre[i];
      const pb = sb.pre[i];
      if (pa === pb) continue;
      if (typeof pa === "number" && typeof pb === "number") return pa - pb;
      if (typeof pa === "number") return -1;
      if (typeof pb === "number") return 1;
      return pa < pb ? -1 : 1;
    }
    // Same shared prefix: more identifiers outrank fewer (1.0.0-alpha.1
    // > 1.0.0-alpha).
    return sa.pre.length - sb.pre.length;
  }
}

export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

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
    releases.sort((a, b) => compareVersions(b.version, a.version));
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
    return {
      version,
      path: binPath,
      origin: managed ? "managed install (PATH shim)" : "PATH",
      detail: `managed root: ${root}${releases.length > 0 ? ` · ${releases.length} release(s)` : ""}`,
      installedVersions: installedVersions.length > 0 ? installedVersions : null,
      error: version ? null : capError(parseError ?? "unknown error"),
    };
  }

  // No PATH entry: the install still counts if its releases are there.
  if (releases.length > 0) {
    const active =
      (shimReal ? releases.find((release) => shimReal.startsWith(release.dir + "/")) : undefined) ?? releases[0];
    return {
      version: active.version,
      path: shimReal ?? active.dir,
      origin: "managed install (no PATH entry)",
      detail: `managed root: ${root} · ${releases.length} release(s)`,
      installedVersions,
      error: null,
    };
  }

  return { version: null, path: null, origin: null, detail: null, installedVersions: null, error: null };
}

export async function probeMsb(env: ProbeEnv, extraMsbPaths: readonly string[]): Promise<ToolStatus> {
  const extras = await resolveExtraBins("msb", extraMsbPaths, env);
  const onPath = await resolveOnPath("msb", env.pathEnv);

  let bin: string | null = onPath;
  let origin: string | null = onPath ? "PATH" : null;
  if (!bin && extras.length > 0) {
    bin = extras[0].bin;
    origin = "extra path";
  }

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
    extras.length > 0 ? `${extras.length} extra path(s) configured` : null,
  ].filter((bit): bit is string => bit !== null);
  return {
    version,
    path: realBin,
    origin,
    detail: detailBits.length > 0 ? detailBits.join(" · ") : null,
    installedVersions: null,
    error: version ? null : capError(parseError ?? "unknown error"),
  };
}

/** Probe every watched toolchain; per-tool failures degrade into a
 * ToolStatus with an error rather than failing the whole snapshot. */
export async function collectSnapshot(args: SnapshotArgs, env: ProbeEnv): Promise<MachineSnapshot> {
  const [pi, msb] = await Promise.all([
    guard(() => probePi(env, args.piManagedRoot), "pi"),
    guard(() => probeMsb(env, args.extraMsbPaths), "msb"),
  ]);
  return {
    checkedAt: Date.now(),
    platform: `${process.platform}/${process.arch}`,
    pi,
    msb,
  };
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
