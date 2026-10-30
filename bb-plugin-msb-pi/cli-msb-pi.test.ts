import { describe, expect, test } from "vitest";
import {
  findMachines,
  gatherState,
  renderHistory,
  renderMachine,
  renderTool,
  renderWatch,
  type MsbPiBackend,
} from "./cli-msb-pi";
import type { MachineState, ToolStatus, WatchOutput } from "./snapshot";

const status = (version: string | null, extra: Partial<ToolStatus> = {}): ToolStatus => ({
  version,
  path: version ? `/usr/bin/${version}` : null,
  origin: version ? "PATH" : null,
  detail: null,
  installedVersions: null,
  error: null,
  ...extra,
});

function machine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    hostId: "host_1",
    hostName: "Jeff's box",
    connected: true,
    snapshot: {
      checkedAt: 1_000,
      platform: "linux/x64",
      pi: status("1.3.0", {
        path: "/home/jeff/.pi/agent/bin/pi",
        origin: "managed install (PATH shim)",
        detail: "managed root: /home/jeff/.pi/agent/install · 2 release(s)",
        installedVersions: ["1.3.0", "1.2.9"],
      }),
      msb: status("0.7.11", { detail: "state dir: ~/.msb" }),
    },
    lastError: null,
    lastErrorAt: null,
    ...overrides,
  };
}

describe("findMachines", () => {
  const machines = [
    machine({ hostId: "host_abc", hostName: "Jeff's box" }),
    machine({ hostId: "host_xyz", hostName: "build-2" }),
  ];

  test("matches by host id (exact or prefix) and name prefix", () => {
    expect(findMachines(machines, "host_abc").map((m) => m.hostId)).toEqual(["host_abc"]);
    expect(findMachines(machines, "host").map((m) => m.hostId)).toEqual(["host_abc", "host_xyz"]);
    expect(findMachines(machines, "jeff").map((m) => m.hostName)).toEqual(["Jeff's box"]);
  });

  test("case-insensitivity", () => {
    expect(findMachines(machines, "BUILD-")).toHaveLength(1);
  });

  test("no match is empty, not a throw", () => {
    expect(findMachines(machines, "nobody")).toEqual([]);
    expect(findMachines(machines, "")).toEqual([]);
  });
});

describe("renderMachine / renderTool", () => {
  test("a full probed machine renders two tool lines plus tails", () => {
    const lines = renderMachine(machine(), 1_000);
    const text = lines.join("\n");
    expect(lines[0]).toContain("Jeff's box — connected · linux/x64 · checked just now");
    expect(text).toContain("pi   1.3.0 · managed install (PATH shim)");
    expect(text).toContain("msb  0.7.11 · PATH");
    expect(text).toContain("/home/jeff/.pi/agent/bin/pi");
    expect(text).toContain("managed root: /home/jeff/.pi/agent/install · 2 release(s)");
    expect(text).toContain("state dir: ~/.msb");
    expect(text).toContain("releases: 1.3.0, 1.2.9");
  });

  test("an unprobed machine hints at refresh, absent msb reads as a fact", () => {
    const lines = renderMachine(
      machine({ snapshot: null, connected: false, lastError: "machine is disconnected", lastErrorAt: 500 }),
      1_000,
    );
    expect(lines[0]).toContain("disconnected");
    expect(lines[0]).toContain("error: machine is disconnected");
    const [piLine, msbLine] = [lines[1], lines[2]];
    expect(piLine).toContain("not found");
    expect(msbLine).toContain("not found");
  });

  test("renderTool speaks fail-soft states distinctly", () => {
    expect(renderTool("msb", null)[0]).toContain("not found");
    expect(renderTool("msb", status("0.7.0", { error: "boom" }))[0]).toBe("  msb  0.7.0 · PATH");
    expect(renderTool("msb", status(null, { error: "boom" }))[0]).toBe("  msb  probe failed");
    const errorTail = renderTool("msb", status(null, { error: "boom" }));
    expect(errorTail.at(-1)).toContain("error: boom");
  });
});

describe("renderWatch", () => {
  test("counts machines and annotates a refresh", () => {
    const state: WatchOutput = { generatedAt: 0, machines: [machine(), machine({ hostId: "h2", hostName: "build-2", snapshot: null })], history: [] };
    const text = renderWatch(state, { now: 2_000, refreshed: { triggered: ["host_1"], failed: ["h2"], missing: [] } });
    expect(text.split("\n")[0]).toBe("2 machine(s) · refreshed 1 machine(s), 1 failed");
    expect(text).toContain("build-2 — connected · — · no probe yet");
  });
});

describe("renderHistory", () => {
  test("phrases transitions per kind", () => {
    const text = renderHistory(
      [
        { at: 1, hostId: "host_1", hostName: "Jeff's box", tool: "pi", kind: "changed", from: "1.2.9", to: "1.3.0" },
        { at: 2, hostId: "host_1", hostName: "Jeff's box", tool: "msb", kind: "added", from: null, to: "0.7.11" },
        { at: 3, hostId: "host_1", hostName: "Jeff's box", tool: "pi", kind: "removed", from: "1.3.0", to: null },
      ],
      25,
    );
    expect(text).toContain("pi 1.2.9 → 1.3.0");
    expect(text).toContain("msb appeared at 0.7.11");
    expect(text).toContain("pi 1.3.0 now missing");
    expect(text).toContain("Version history — 3 change(s)");
  });

  test("empty history reads, never explodes", () => {
    expect(renderHistory([], 25)).toContain("no changes recorded yet");
  });
});

describe("gatherState", () => {
  const backend: MsbPiBackend = {
    read: async () => ({ generatedAt: 7, machines: [machine(), machine({ hostId: "host_2", hostName: "build-2", snapshot: null })], history: [] }),
    refresh: async (hostIds) => ({
      triggered: hostIds ?? ["host_1", "host_2"],
      failed: [],
      missing: [],
    }),
  };

  test("unfiltered + no refresh: one read, no re-read", async () => {
    const { state, refreshed } = await gatherState(backend, "  ", false);
    expect(refreshed).toBeNull();
    expect(state.generatedAt).toBe(7);
    expect(state.machines).toHaveLength(2);
  });

  test("machine filter narrows machines and history, before refresh", async () => {
    let reads = 0;
    const counting: MsbPiBackend = {
      ...backend,
      read: async () => {
        reads += 1;
        return backend.read();
      },
    };
    const { state, refreshed } = await gatherState(counting, "jeff", true);
    expect(refreshed?.triggered).toEqual(["host_1"]);
    expect(state.machines.map((m) => m.hostName)).toEqual(["Jeff's box"]);
    expect(reads).toBe(2);
  });

  test("unknown machine reference throws with the roster in the hint", async () => {
    await expect(gatherState(backend, "nobody", false)).rejects.toMatchObject({
      code: "not_found",
      hint: expect.stringContaining("build-2"),
    });
  });
});
