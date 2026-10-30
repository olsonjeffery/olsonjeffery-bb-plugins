import { describe, expect, test } from "vitest";
import { formatAgo } from "./ago";

const NOW = 60_000_000;

describe("formatAgo", () => {
  test("recent buckets", () => {
    expect(formatAgo(NOW, NOW)).toBe("just now");
    expect(formatAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(formatAgo(NOW - 60_000, NOW)).toBe("60s ago");
    expect(formatAgo(NOW - 7 * 60_000, NOW)).toBe("7m ago");
    expect(formatAgo(NOW - 90 * 60_000, NOW)).toBe("1h 30m ago");
    expect(formatAgo(NOW - 2 * 3_600_000, NOW)).toBe("2h ago");
    expect(formatAgo(NOW - 4 * 24 * 3_600_000, NOW)).toBe("4d ago");
  });

  test("older than a week: stable date", () => {
    const iso = new Date(NOW - 40 * 24 * 3_600_000).toISOString().slice(0, 10);
    expect(formatAgo(NOW - 40 * 24 * 3_600_000, NOW)).toBe(iso);
  });
});
