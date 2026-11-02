import { describe, expect, test } from "vitest";
import {
  applyNpmResult,
  dueForRefetch,
  NPM_LATEST_TTL_MS,
  packageNamesOf,
  parseDistTags,
  projectNpmLatest,
} from "./npm-latest";
import type { ToolStatus } from "./snapshot";

const status = (packageName: string | null): ToolStatus => ({
  version: "1.0.0",
  path: "/bin/x",
  origin: null,
  detail: null,
  installedVersions: null,
  error: null,
  packageName,
});

describe("packageNamesOf", () => {
  test("collects every derivable package name", () => {
    const names = packageNamesOf([
      { pi: status("@earendil-works/pi-coding-agent"), msb: status("microsandbox") },
      { pi: status(null), msb: status("microsandbox") },
    ]);
    expect(names).toEqual(["@earendil-works/pi-coding-agent", "microsandbox"]);
  });
});

describe("dueForRefetch", () => {
  test("unset, stale and past-TTL entries are due; fresh ones are not", () => {
    const now = Date.now();
    const cache = {
      fresh: { packageName: "fresh", version: "1.0.0", fetchedAt: now - 1_000, stale: false },
      staleFlag: { packageName: "staleFlag", version: "1.0.0", fetchedAt: now - 1_000, stale: true },
      old: { packageName: "old", version: "1.0.0", fetchedAt: now - NPM_LATEST_TTL_MS - 1, stale: false },
    };
    const due = dueForRefetch(cache, ["fresh", "staleFlag", "old", "unknown"], now);
    expect(due.sort()).toEqual(["old", "staleFlag", "unknown"]);
  });
});

describe("parseDistTags", () => {
  test("reads the registry's dist-tags document", () => {
    expect(parseDistTags(`{"latest":"0.7.13","rc":"0.8.0-rc.1"}`)).toEqual({ latest: "0.7.13", error: null });
  });
  test("tolerates a full packument with a dist-tags member", () => {
    expect(parseDistTags(`{"name":"x","dist-tags":{"latest":"1.4.0"}}`)).toEqual({ latest: "1.4.0", error: null });
  });
  test("failure modes are explicit, never invented versions", () => {
    expect(parseDistTags("nope").error).toBe("registry returned non-JSON");
    expect(parseDistTags("{}").error).toBe("registry answer has no latest dist-tag");
    expect(parseDistTags(`{"latest":42}`).error).toBe("latest dist-tag is not a version string");
    expect(parseDistTags("[]").error).toBe("registry answer is not an object");
  });
});

describe("applyNpmResult", () => {
  test("a success replaces the entry and clears staleness", () => {
    const next = applyNpmResult({}, "microsandbox", { latest: "0.7.13", error: null }, 5);
    expect(next.microsandbox).toEqual({ packageName: "microsandbox", version: "0.7.13", fetchedAt: 5, stale: false });
  });

  test("a failure keeps the previous good answer but marks it stale", () => {
    const good = { packageName: "p", version: "1.0.0", fetchedAt: 1, stale: false };
    const next = applyNpmResult({ p: good }, "p", { latest: null, error: "offline" }, 9);
    expect(next.p).toEqual({ packageName: "p", version: "1.0.0", fetchedAt: 9, stale: true });
  });

  test("a failure with no prior answer records nulls, still staled", () => {
    const next = applyNpmResult({}, "q", { latest: null, error: "offline" }, 9);
    expect(next.q).toEqual({ packageName: "q", version: null, fetchedAt: 9, stale: true });
  });
});

describe("projectNpmLatest", () => {
  test("only installed packages surface", () => {
    const cache = {
      p: { packageName: "p", version: "1.0.0", fetchedAt: 1, stale: false },
      ghost: { packageName: "ghost", version: "2.0.0", fetchedAt: 1, stale: false },
    };
    expect(projectNpmLatest(cache, ["p"])).toEqual([cache.p]);
    expect(projectNpmLatest(cache, [])).toEqual([]);
  });
});
