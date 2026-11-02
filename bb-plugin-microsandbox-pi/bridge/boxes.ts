// bb-plugin-microsandbox-pi — box lifecycle for one bridge child.
//
// Each bridge process owns the boxes it spawns for its threads and one
// shared "meta" box for sessionless requests. Policy:
//   - names are deterministic per thread;
//   - on cold start a box owned by ANOTHER bridge child (or an older
//     life of this one) is force-removed so fresh mounts/routes/cwd win
//     — a running box's guest shim only ever dials its own relay, so
//     reusing a foreign box would attach a live child to dead lanes;
//   - sessions survive box restarts because the pi session dir is a rw
//     host bind (see sessionDirMount).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { BridgeOptions } from "./options";
import {
  buildMsbRunArgs,
  boxNameForThread,
  guestEnvJson,
  metaBoxName,
  metaSocketsDir,
  piLauncherCandidates,
  threadSocketsDir,
} from "./options";
import type { MsbExec } from "./msbexec";
import { sandboxNamesFromList } from "./msbexec";

export interface BoxAssets {
  assetsDir: string;
  bridgeBundle: string;
  /** bb's own bridge worker bootstrap (host path). */
  workerPath: string;
  runnerPy: string;
  msbBin: string;
  nodeBin: string;
  /** bb data root (…/.bb) — pi session dir mounts live here. */
  bbRoot: string;
}

export interface BoxRequest {
  threadId: string | null; // null = meta box
  cwd: string | null; // meta box runs without workspace mount
  options: BridgeOptions;
  env: NodeJS.ProcessEnv;
}

export interface BoxHandle {
  name: string;
  socketsDir: string;
}

interface OwnershipMark {
  pid: number;
  boot: string;
}

function sameProcess(mark: OwnershipMark | null): boolean {
  return mark !== null && mark.pid === process.pid;
}

/** in-box env file: msb secret placeholders + the pi launcher for the
 * provider-pi artifact's `pi --mode rpc` children (read-only mounted
 * ~/.pi/agent keeps auth + skills; falls back to PATH-side `pi`). */
async function guestEnvContent(
  dir: string,
  request: BoxRequest,
): Promise<{ src: string } | null> {
  const content: Record<string, string> = { ...guestEnvJson(request.options, request.env) };
  for (const candidate of piLauncherCandidates(request.options, request.env)) {
    try {
      await stat(candidate);
      content.BB_PI_BRIDGE_COMMAND = candidate;
      break;
    } catch {
      /* launcher missing on this machine: try the next candidate */
    }
  }
  content.BB_PI_BRIDGE_SESSION_DIR = join(request.env.HOME ?? "/root", ".bb", "pi-bridge-sessions");
  if (Object.keys(content).length === 0) return null;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "env.json"), JSON.stringify(content));
  return { src: join(dir, "env.json") };
}

async function isOwnedByThisProcess(socketsDir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(socketsDir, "owner.json"), "utf8");
    const parsed = JSON.parse(raw) as OwnershipMark;
    return sameProcess(parsed);
  } catch {
    return false;
  }
}

async function markOwnership(socketsDir: string): Promise<void> {
  const mark: OwnershipMark = { pid: process.pid, boot: new Date().toISOString() };
  await mkdir(socketsDir, { recursive: true });
  await writeFile(join(socketsDir, "owner.json"), JSON.stringify(mark));
}

/** Create (or recreate) the box; resolves when `msb list` shows it
 * running so route connects can race safely. */
export async function ensureBox(
  exec: MsbExec,
  assets: BoxAssets,
  request: BoxRequest,
  prepare?: { prepareSocketDir: (dir: string) => Promise<void>; skipOwnership?: boolean },
): Promise<BoxHandle> {
  const prepareSocketDir = prepare?.prepareSocketDir;
  const skipOwnership = prepare?.skipOwnership === true;
  const msbBin = assets.msbBin;
  if (msbBin === null) throw new Error("msb binary unresolved");
  const isMeta = request.threadId === null;
  const name = isMeta ? metaBoxName() : boxNameForThread(request.threadId as string);
  const socketsDir = isMeta
    ? metaSocketsDir(assets.assetsDir)
    : threadSocketsDir(assets.assetsDir, request.threadId as string);

  const list = await exec.run(assets.msbBin, ["list"], 20_000);
  const states = sandboxNamesFromList(list.stdout || list.stderr);
  const existing = states.get(name);

  // A live box is only meaningful if THIS bridge child owns it (its
  // guest shim dials these exact socket paths); otherwise force fresh.
  if (existing === "running" && (await isOwnedByThisProcess(socketsDir))) {
    return { name, socketsDir };
  }
  if (existing !== undefined) {
    await exec.run(assets.msbBin, ["remove", "-f", name], 60_000);
  }

  if (prepareSocketDir !== undefined) {
    await prepareSocketDir(socketsDir);
  } else {
    await mkdir(socketsDir, { recursive: true });
    for (const sock of ["in.sock", "out.sock", "err.sock"]) {
      // Stale listeners confuse the msb route dial; fresh dir wins.
      await rm(join(socketsDir, sock), { force: true });
    }
  }
  if (!skipOwnership) await markOwnership(socketsDir);

  const envFile = await guestEnvContent(socketsDir, request);
  const bridgeBundle = assets.bridgeBundle;
  if (bridgeBundle === null) throw new Error("bb provider-pi artifact unresolved — start the bb daemon (its plugin-host-artifacts) or set MSP_PROVIDER_ARTIFACT");
  if (assets.workerPath === null) throw new Error("bridge worker bootstrap unresolved — this child must be spawned by bb's bb-provider-bridge-worker");
  const sessionDir = join(assets.bbRoot, "pi-bridge-sessions");
  await mkdir(sessionDir, { recursive: true });

  const runArgs = buildMsbRunArgs({
    options: request.options,
    boxName: name,
    socketsDir,
    workspaceMount: request.cwd ? { src: request.cwd, dest: request.cwd } : null,
    msbBin,
    bridgeBundle,
    workerPath: assets.workerPath,
    runnerPy: assets.runnerPy,
    nodeBin: assets.nodeBin,
    envPresent: request.env,
    envFileMount: envFile,
    sessionDirMount: { src: sessionDir },
  });
  const run = await exec.run(assets.msbBin, runArgs, 120_000);
  if (!run.ok) {
    throw new Error(`msb run failed: ${(run.stderr || run.stdout || "(no output)").slice(0, 300)}`);
  }

  // Wait for `msb list` to show the box running (image pull can dominate
  // a first boot; warm boots are sub-second). A deadline miss IS a boot
  // failure: returning without a live box would strand lanes forever.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const listing = await exec.run(assets.msbBin, ["list"], 20_000);
    const running = sandboxNamesFromList(listing.stdout || listing.stderr).get(name);
    if (running === "running") return { name, socketsDir };
    if (running === "stopped" || running === "crashed") {
      throw new Error(`box ${name} did not come up (state: ${running})`);
    }
    await sleep(500);
  }
  throw new Error(`box ${name} never reached running state within 120s (msb list never showed it)`);
}

/** Best-effort remove; used on relay failure and shutdown. */
export async function removeBox(exec: MsbExec, msbBin: string, name: string): Promise<void> {
  await exec.run(msbBin, ["remove", "-f", name], 60_000).catch(() => undefined);
}
