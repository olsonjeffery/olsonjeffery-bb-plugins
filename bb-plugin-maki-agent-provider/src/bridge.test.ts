import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMakiMaintenanceLine } from "./bridge.js";

interface CapturedLine {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

function captureStdout(): { lines: CapturedLine[]; restore: () => void } {
  const writes: CapturedLine[] = [];
  const original = process.stdout.write;
  const bound = original.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    const text = String(chunk).trim();
    if (text !== "") writes.push(JSON.parse(text));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines: writes,
    restore: () => {
      process.stdout.write = bound;
    },
  };
}

describe("handleMakiMaintenanceLine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims only provider/installation requests", () => {
    expect(
      handleMakiMaintenanceLine(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "model/list", params: {} }),
      ),
    ).toBe(false);
    expect(handleMakiMaintenanceLine("{not json")).toBe(false);
    expect(
      handleMakiMaintenanceLine(
        JSON.stringify({ jsonrpc: "2.0", method: "provider/health" }),
      ),
    ).toBe(false);
  });

  it("answers installation status for an installed maki", { timeout: 20_000 }, async () => {
    const captured = captureStdout();
    try {
      const claimed = handleMakiMaintenanceLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "provider/installation/status",
          params: { providerId: "maki", checkUpdates: true },
        }),
      );
      expect(claimed).toBe(true);
      await vi.waitFor(() => {
        expect(captured.lines.some((line) => line.id === 9)).toBe(true);
      });
      const reply = captured.lines.find((line) => line.id === 9);
      expect(reply?.error).toBeUndefined();
      const status = reply?.result as Record<string, unknown>;
      expect(status.installed).toBe(true);
      expect(status.executableName).toBe("maki");
      expect(String(status.currentVersion)).toMatch(/^\d+\.\d+\.\d+/u);
      expect(status.versionUnsupported).toBe(false);
    } finally {
      captured.restore();
    }
  });

  it("refuses an update run while up to date", { timeout: 20_000 }, async () => {
    const captured = captureStdout();
    try {
      handleMakiMaintenanceLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "provider/installation/run",
          params: { providerId: "maki", action: "update" },
        }),
      );
      await vi.waitFor(() => {
        expect(captured.lines.some((line) => line.id === 10)).toBe(true);
      });
      const reply = captured.lines.find((line) => line.id === 10);
      const result = reply?.result as {
        available: boolean;
        message?: string;
        command?: { args: string[] };
      };
      if (!result.available) {
        expect(result.message).toContain("No maki update");
      } else {
        expect(result.command?.args).toContain("update");
      }
    } finally {
      captured.restore();
    }
  });
});
