import { describe, expect, test } from "vitest";
import { diffSnapshots } from "./diff";
import type { MachineSnapshot } from "./snapshot";

function snapshot(overrides: { checkedAt?: number; pi: string | null; msb: string | null }): MachineSnapshot {
  const tool = (version: string | null) => ({
    version,
    path: version ? `/bin/${version}` : null,
    origin: version ? "PATH" : null,
    detail: null,
    installedVersions: null,
    error: null,
  });
  return {
    checkedAt: overrides.checkedAt ?? 1000,
    platform: "linux/x64",
    pi: tool(overrides.pi),
    msb: tool(overrides.msb),
  };
}

const host = { hostId: "host_1", hostName: "Jeff's box" };

describe("diffSnapshots", () => {
  test("first sighting of a tool is an 'added' entry", () => {
    const entries = diffSnapshots(null, snapshot({ pi: "1.3.0", msb: null }), host);
    expect(entries).toEqual([
      { at: 1000, hostId: "host_1", hostName: "Jeff's box", tool: "pi", kind: "added", from: null, to: "1.3.0" },
    ]);
  });

  test("a version change names both ends", () => {
    const entries = diffSnapshots(
      snapshot({ pi: "1.2.9", msb: "0.7.10" }),
      snapshot({ checkedAt: 2000, pi: "1.3.0", msb: "0.7.10" }),
      host,
    );
    expect(entries).toEqual([
      { at: 2000, hostId: "host_1", hostName: "Jeff's box", tool: "pi", kind: "changed", from: "1.2.9", to: "1.3.0" },
    ]);
  });

  test("a disappearance is recorded as 'removed'", () => {
    const entries = diffSnapshots(
      snapshot({ pi: "1.3.0", msb: "0.7.11" }),
      snapshot({ checkedAt: 3000, pi: "1.3.0", msb: null }),
      host,
    );
    expect(entries).toEqual([
      { at: 3000, hostId: "host_1", hostName: "Jeff's box", tool: "msb", kind: "removed", from: "0.7.11", to: null },
    ]);
  });

  test("no change, no entries", () => {
    const before = snapshot({ pi: "1.3.0", msb: "0.7.11" });
    expect(diffSnapshots(before, before, host)).toEqual([]);
  });

  test("a tool's release scope scanning is left to the probe; only versions diff", () => {
    const before = snapshot({ pi: "1.3.0", msb: null });
    const after = { ...snapshot({ checkedAt: 4000, pi: "1.3.0", msb: null }) };
    after.pi = { ...after.pi, installedVersions: ["1.3.0", "1.2.9"] };
    expect(diffSnapshots(before, after, host)).toEqual([]);
  });
});
