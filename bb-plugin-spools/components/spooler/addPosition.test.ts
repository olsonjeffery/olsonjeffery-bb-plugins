import { describe, expect, it, vi } from "vitest";
import { joinStampFor } from "./addPosition";

describe("joinStampFor", () => {
  it("queues at the bottom or stacks on top", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      expect(joinStampFor("bottom")).toBe(1_000);
      expect(joinStampFor("top")).toBe(-1_000);
    } finally {
      now.mockRestore();
    }
  });

  it("makes each later top add's stamp more negative than the last", () => {
    const ticks = [1_000, 2_000];
    const now = vi
      .spyOn(Date, "now")
      .mockImplementation(() => ticks.shift() ?? 3_000);
    try {
      expect(joinStampFor("top")).toBe(-1_000);
      expect(joinStampFor("top")).toBe(-2_000);
    } finally {
      now.mockRestore();
    }
  });
});
