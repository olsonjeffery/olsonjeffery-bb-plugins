import { chmod, mkdir, mkdtemp, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  collectSnapshot,
  compareVersions,
  expandHome,
  parseVersion,
  probeMsb,
  probePi,
  resolveOnPath,
  sortVersionsDesc,
  toSemver,
  type ProbeEnv,
  type Runner,
} from "./probe";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "msp-probe-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  // mkdtemp leaves little trees; rm came in for the rc: fs.rm recursive.
  const { rm } = await import("node:fs/promises");
  for (const dir of tempRoots.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("parseVersion", () => {
  test("reads plain, prefixed and labeled outputs", () => {
    expect(parseVersion("1.3.0")).toBe("1.3.0");
    expect(parseVersion("pi 1.3.0")).toBe("1.3.0");
    expect(parseVersion("msb-cli 0.7.11")).toBe("0.7.11");
    expect(parseVersion("microsandbox, version 0.7.11 (build 20261028)")).toBe("0.7.11");
    expect(parseVersion("v1.3.0")).toBe("1.3.0");
    expect(parseVersion("pi 1.10.2")).toBe("1.10.2");
  });

  test("keeps prerelease and build suffixes", () => {
    expect(parseVersion("msb 0.7.11-rc.1")).toBe("0.7.11-rc.1");
    expect(parseVersion("pi 1.3.0-beta")).toBe("1.3.0-beta");
  });

  test("refuses non-versions and four-part numbers", () => {
    expect(parseVersion("usage: msb [--help]")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("version file 1.2.34.56")).toBeNull();
  });
});

describe("compareVersions / sortVersionsDesc", () => {
  test("orders numerically and by prerelease rules", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0+build")).toBe(0); // build metadata: ignored
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  test("loose names never crash the sort and lose to real semver", () => {
    const sorted = sortVersionsDesc(["banana", "1.2.3", "apple", "0.9.0"]);
    expect(sorted).toContain("banana");
    expect(sorted).toContain("apple");
    expect(sorted[0]).toBe("1.2.3");
    expect(sorted.slice(1)).toEqual(expect.arrayContaining(["apple", "banana"]));
    expect(sorted[0]).not.toBe("apple");
  });

  test("toSemver rejects month-style junk", () => {
    expect(toSemver("2026.10")).toBeNull();
    expect(toSemver("2026.10.1")).not.toBeNull();
  });
});

describe("expandHome", () => {
  const home = "/home/someone";
  test("expands ~ and ~/ forms", () => {
    expect(expandHome("~", home)).toBe(home);
    expect(expandHome("~/nono-lab/msb", home)).toBe(join(home, "nono-lab/msb"));
    expect(expandHome("  ~/tools  ", home)).toBe(join(home, "tools"));
  });

  test("passes absolute paths through", () => {
    expect(expandHome("/opt/msb", home)).toBe("/opt/msb");
    expect(expandHome("~other/lib", home)).toBe("~other/lib");
  });
});

describe("resolveOnPath", () => {
  test.skipIf(process.platform === "win32")("finds executables across PATH", async () => {
    const dir = await tempRoot();
    const bin = join(dir, "msp-testable");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    const found = await resolveOnPath("msp-testable", `/nonexistent:${dir}`);
    expect(found).toBe(bin);
  });

  test.skipIf(process.platform === "win32")("returns null for a bare name", async () => {
    expect(await resolveOnPath("msp-definitely-absent", "/nonexistent")).toBeNull();
    expect(await resolveOnPath("msp-definitely-absent", undefined)).toBeNull();
  });
});

function stubRunner(map: Record<string, string>): Runner {
  return async (bin, args) => {
    for (const [pattern, output] of Object.entries(map)) {
      if (bin.includes(pattern)) {
        return { ok: args.includes("--version"), stdout: args.includes("--version") ? output : "", stderr: "" };
      }
    }
    return { ok: false, stdout: "", stderr: "not found" };
  };
}

const emptyProbe: ProbeEnv = { runner: stubRunner({}), pathEnv: undefined, home: "/home/fixture", managedRootEnv: undefined };

describe("probeMsb", () => {
  test("absence is a fact, not an error", async () => {
    const status = await probeMsb(emptyProbe, []);
    expect(status).toEqual({
      version: null,
      path: null,
      origin: null,
      detail: "not found on PATH",
      installedVersions: null,
      error: null,
    });
  });

  test.skipIf(process.platform === "win32")("reads the version from PATH and reports the state dir", async () => {
    const home = await tempRoot();
    await mkdir(join(home, ".msb"), { recursive: true });
    const binDir = await tempRoot();
    const { writeFile } = await import("node:fs/promises");
    const bin = join(binDir, "msb");
    await writeFile(bin, "#!/bin/sh\necho 'msb-cli 0.7.11'\n");
    await chmod(bin, 0o755);

    // The stub runner answers for anything matched by substring; the
    // file on disk only has to pass the executable resolution.
    const status = await probeMsb(
      { runner: stubRunner({ [bin]: "msb-cli 0.7.11\n" }), pathEnv: binDir, home },
      [],
    );
    expect(status.version).toBe("0.7.11");
    expect(status.origin).toBe("PATH");
    expect(status.detail).toBe("state dir: ~/.msb");
    expect(status.error).toBeNull();
  });

  test.skipIf(process.platform === "win32")("honors extra-path lines including ~", async () => {
    const home = await tempRoot();
    const lab = join(home, "nono-lab");
    await mkdir(lab, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(lab, "msb"), "#!/bin/sh\necho '0.7.11'\n");
    await chmod(join(lab, "msb"), 0o755);
    const status = await probeMsb(
      { runner: stubRunner({ "nono-lab": "0.7.11" }), pathEnv: "/nonexistent", home },
      ["~/nono-lab"],
    );
    expect(status.version).toBe("0.7.11");
    expect(status.origin).toBe("extra path");
    expect(status.detail).toContain("1 extra path(s)");
  });

  test.skipIf(process.platform === "win32")("a hung --version becomes a readable error, not a throw", async () => {
    const home = await tempRoot();
    const binDir = await tempRoot();
    const { writeFile } = await import("node:fs/promises");
    const bin = join(binDir, "msb");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    const status = await probeMsb(
      {
        runner: async () => ({ ok: false, stdout: "", stderr: "timed out after 8s running msb" }),
        pathEnv: binDir,
        home,
        managedRootEnv: undefined,
      },
      [],
    );
    expect(status.version).toBeNull();
    expect(status.error).toBe("timed out after 8s running msb");
    expect(status.origin).toBe("PATH");
  });
});

describe("probePi", () => {
  test.skipIf(process.platform === "win32")("lists managed releases newest-first and picks the shim's one", async () => {
    const home = await tempRoot();
    const root = join(home, ".pi", "agent", "install");
    const releases = join(root, "releases");
    await mkdir(join(releases, "1.2.9", "bin"), { recursive: true });
    await mkdir(join(releases, "1.3.0", "bin"), { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    await symlink(join(releases, "1.3.0", "bin", "pi"), join(root, "bin", "pi"));

    const status = await probePi({ ...emptyProbe, home }, "");
    expect(status.installedVersions).toEqual(["1.3.0", "1.2.9"]);
    expect(status.version).toBe("1.3.0");
    expect(status.origin).toBe("managed install (no PATH entry)");
    expect(status.error).toBeNull();
  });

  test.skipIf(process.platform === "win32")("ignores non-release directories", async () => {
    const home = await tempRoot();
    const releases = join(home, ".pi", "agent", "install", "releases");
    await mkdir(join(releases, "1.3.0"), { recursive: true });
    await mkdir(join(releases, "tmp-install"), { recursive: true });
    const status = await probePi({ ...emptyProbe, home }, "");
    expect(status.installedVersions).toEqual(["1.3.0"]);
  });

  test.skipIf(process.platform === "win32")("honors the managed-root override", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "releases", "9.9.9"), { recursive: true });
    const status = await probePi(emptyProbe, root);
    expect(status.installedVersions).toEqual(["9.9.9"]);
    expect(status.version).toBe("9.9.9");
    expect(status.detail).toContain(root);
  });

  test("records nothing when neither PATH nor managed install exists", async () => {
    const home = await tempRoot();
    const status = await probePi({ runner: stubRunner({}), pathEnv: "/nonexistent", home, managedRootEnv: undefined }, "");
    expect(status.version).toBeNull();
    expect(status.path).toBeNull();
    expect(status.origin).toBeNull();
    expect(status.error).toBeNull();
  });
});

describe("collectSnapshot", () => {
  test.skipIf(process.platform === "win32")("degrades a throwing probe into an error status", async () => {
    const binDir = await tempRoot();
    const { writeFile } = await import("node:fs/promises");
    const bin = join(binDir, "msb");
    const piBin = join(binDir, "pi");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    await writeFile(piBin, "#!/bin/sh\nexit 0\n");
    await chmod(piBin, 0o755);
    const failingRunner: Runner = async () => {
      throw new Error("runner exploded");
    };
    const snapshot = await collectSnapshot(
      { extraMsbPaths: [], piManagedRoot: "" },
      { runner: failingRunner, pathEnv: binDir, home: "/home/fixture", managedRootEnv: undefined },
    );
    expect(snapshot.platform).toBe(`${process.platform}/${process.arch}`);
    expect(snapshot.checkedAt).toBeGreaterThan(0);
    expect(snapshot.pi.error).toBe("runner exploded");
    expect(snapshot.pi.version).toBeNull();
    expect(snapshot.msb.error).toBe("runner exploded");
  });

  test("passes managed-root override through to the pi probe", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "releases", "2.0.0"), { recursive: true });
    const snapshot = await collectSnapshot(
      { extraMsbPaths: [], piManagedRoot: root },
      { runner: stubRunner({}), pathEnv: "/nonexistent", home: homedir() },
    );
    expect(snapshot.pi.installedVersions).toEqual(["2.0.0"]);
  });
});
