// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { joinStampFor, readAddPosition, writeAddPosition } from "./addPosition";

describe("addPosition", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to bottom when nothing (or garbage) is stored", () => {
    expect(readAddPosition()).toBe("bottom");
    localStorage.setItem("spooler-sidebar:add-position:v1", "sideways");
    expect(readAddPosition()).toBe("bottom");
  });

  it("round-trips a write", () => {
    writeAddPosition("top");
    expect(readAddPosition()).toBe("top");
    expect(localStorage.getItem("spooler-sidebar:add-position:v1")).toBe("top");
  });

  it("writes announce themselves on the window", () => {
    const seen = vi.fn();
    window.addEventListener("spooler-add-position-changed", seen);
    try {
      writeAddPosition("top");
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("spooler-add-position-changed", seen);
    }
  });

  it("joinStampFor queues at the bottom or stacks on top", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      expect(joinStampFor("bottom")).toBe(1_000);
      expect(joinStampFor("top")).toBe(-1_000);
    } finally {
      now.mockRestore();
    }
  });
});
