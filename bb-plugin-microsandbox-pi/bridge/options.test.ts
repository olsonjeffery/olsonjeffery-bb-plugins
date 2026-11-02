// bb-plugin-microsandbox-pi — box plan tests: mounts, vsock routes,
// in-box worker command and guest env shape.
import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import {
  DEFAULT_BRIDGE_OPTS,
  boxNameForThread,
  buildMsbRunArgs,
  metaBoxName,
  metaSocketsDir,
  parseBridgeOptions,
  piLauncherCandidates,
  sanitizeThreadId,
  threadSocketsDir,
} from "./options";

describe("thread box naming", () => {
  it("deterministic msb-safe names per thread", () => {
    expect(boxNameForThread("thr_a1")).toBe("bbp-thra1");
    expect(boxNameForThread("thr/@x…").startsWith("bbp-")).toBe(true);
    expect(metaBoxName()).toBe("bbp-meta");
    expect(boxNameForThread("thr/a1$%")).toBe("bbp-thra1");
  });

  it("sanitize strips unsupported characters and bounds length", () => {
    expect(sanitizeThreadId("a/b/c/d!")).toBe("abcd");
    expect(sanitizeThreadId("x".repeat(40)).length).toBeLessThanOrEqual(24);
    expect(sanitizeThreadId("!@#$")).toBe("anon");
  });
});

describe("mounted args", () => {
  const base: Parameters<typeof buildMsbRunArgs>[0] = {
    options: { ...DEFAULT_BRIDGE_OPTS },
    boxName: "bbp-meta",
    socketsDir: "/tmp/socks",
    workspaceMount: null,
    msbBin: "msb",
    bridgeBundle: "/artifacts/provider-pi/host.mjs",
    workerPath: "/bb/bb-provider-bridge-worker.mjs",
    runnerPy: "/data/msb-runner.py",
    nodeBin: "node",
    envPresent: { HOME: "/root" },
    envFileMount: null,
    sessionDirMount: null,
  };

  it("mounts the artifact, the worker bootstrap and the runner in-box", () => {
    const argv = buildMsbRunArgs(base);
    expect(argv.join(" ")).toContain("/artifacts/provider-pi/host.mjs:/w/provider-pi-host.mjs");
    expect(argv.join(" ")).toContain("/bb/bb-provider-bridge-worker.mjs:/w/bridge-worker.mjs");
    expect(argv.join(" ")).toContain("/data/msb-runner.py:/w/runner.py");
  });

  it("runs the worker with artifact, plugin id and data dir in-box", () => {
    const argv = buildMsbRunArgs(base);
    const dash = argv.indexOf("--");
    expect(argv.slice(dash + 1)).toEqual([
      "python3",
      "/w/runner.py",
      "31337", "32337", "33337",
      "--",
      "node",
      "/w/bridge-worker.mjs",
      "/w/provider-pi-host.mjs",
      "microsandbox-pi",
      "/w/bridge-data",
    ]);
  });

  it("mounts the workspace and session dir read-write when present", () => {
    const argv = buildMsbRunArgs({
      ...base,
      workspaceMount: { src: "/home/x/pj", dest: "/home/x/pj" },
      sessionDirMount: { src: "/root/.bb/pi-bridge-sessions" },
    });
    const before = argv.join(" ");
    expect(before).toContain("/home/x/pj:/home/x/pj:rw");
    expect(before).toContain("/root/.bb/pi-bridge-sessions:/root/.bb/pi-bridge-sessions:rw");
  });

  it("mounts the pi agent dir read-write when piHomeMount is set", () => {
    const argv = buildMsbRunArgs(base);
    expect(argv.join(" ")).toContain(`${homedir()}/.pi/agent:${homedir()}/.pi/agent:rw`);
  });
});

describe("parseBridgeOptions", () => {
  it("keeps the journal flag and extra settings", () => {
    const parsed = parseBridgeOptions(JSON.stringify({ journal: true, image: "custom:1" }));
    expect(parsed.journal).toBe(true);
    expect(parsed.image).toBe("custom:1");
    expect(parsed.piLauncher).toBe("");
  });

  it("bad json falls back to defaults", () => {
    const parsed = parseBridgeOptions("{oops");
    expect(parsed).toEqual(DEFAULT_BRIDGE_OPTS);
  });
});

describe("pi launcher candidates", () => {
  it("explicit setting wins, managed-install default otherwise", () => {
    expect(piLauncherCandidates({ ...DEFAULT_BRIDGE_OPTS, piLauncher: "/opt/pi" }, { HOME: "/root" })).toEqual(["/opt/pi"]);
    expect(piLauncherCandidates({ ...DEFAULT_BRIDGE_OPTS }, { HOME: "/root" })).toEqual(["/root/.pi/agent/bin/pi"]);
  });
});

describe("socket dirs", () => {
  it("meta and thread dirs group under the assets boxes root", () => {
    const assets = "/data";
    expect(metaSocketsDir(assets)).not.toBe(threadSocketsDir(assets, "thr_1"));
    expect(metaSocketsDir(assets).endsWith("/data/boxes/meta")).toBe(true);
  });
});
