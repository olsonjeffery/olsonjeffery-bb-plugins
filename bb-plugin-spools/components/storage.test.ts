// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyPreferences } from "./storage";

const CURRENT = "spools:";
const LEGACY = "codex-sidebar:";
const INTERMEDIATE = "spooler-sidebar:";

describe("migrateLegacyPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("carries legacy preferences forward under the new prefix", () => {
    localStorage.setItem(`${LEGACY}grouping:v1`, "project");
    localStorage.setItem(`${LEGACY}density:v1`, "compact");
    localStorage.setItem(`${LEGACY}smart-views:v1`, "[]");

    migrateLegacyPreferences();

    expect(localStorage.getItem(`${CURRENT}grouping:v1`)).toBe("project");
    expect(localStorage.getItem(`${CURRENT}density:v1`)).toBe("compact");
    expect(localStorage.getItem(`${CURRENT}smart-views:v1`)).toBe("[]");
    expect(localStorage.getItem(`${LEGACY}grouping:v1`)).toBeNull();
  });

  it("carries spooler-sidebar-era preferences forward too", () => {
    localStorage.setItem(`${INTERMEDIATE}grouping:v1`, "section");
    localStorage.setItem(`${INTERMEDIATE}density:v1`, "cozy");

    migrateLegacyPreferences();

    expect(localStorage.getItem(`${CURRENT}grouping:v1`)).toBe("section");
    expect(localStorage.getItem(`${CURRENT}density:v1`)).toBe("cozy");
    expect(localStorage.getItem(`${INTERMEDIATE}grouping:v1`)).toBeNull();
  });

  it("never overwrites a value the user already set post-rename", () => {
    localStorage.setItem(`${LEGACY}density:v1`, "compact");
    localStorage.setItem(`${CURRENT}density:v1`, "auto");

    migrateLegacyPreferences();

    expect(localStorage.getItem(`${CURRENT}density:v1`)).toBe("auto");
  });

  it("deletes retired keys instead of migrating them", () => {
    // Nav placement moved to BB's server-synced UI preferences.
    localStorage.setItem(`${LEGACY}nav-pinned:v1`, '["a"]');
    localStorage.setItem(`${LEGACY}nav-hidden:v1`, '["b"]');

    migrateLegacyPreferences();

    expect(localStorage.getItem(`${CURRENT}nav-pinned:v1`)).toBeNull();
    expect(localStorage.getItem(`${CURRENT}nav-hidden:v1`)).toBeNull();
    expect(localStorage.getItem(`${LEGACY}nav-pinned:v1`)).toBeNull();
  });

  it("runs once and leaves later edits alone", () => {
    localStorage.setItem(`${LEGACY}grouping:v1`, "time");
    migrateLegacyPreferences();

    // A user change after the migration must survive a second call.
    localStorage.setItem(`${CURRENT}grouping:v1`, "section");
    localStorage.setItem(`${LEGACY}stale:v1`, "x");
    migrateLegacyPreferences();

    expect(localStorage.getItem(`${CURRENT}grouping:v1`)).toBe("section");
    // Flag short-circuits the pass, so the stray legacy key is untouched.
    expect(localStorage.getItem(`${LEGACY}stale:v1`)).toBe("x");
  });

  it("only records its flag when there is nothing to migrate", () => {
    migrateLegacyPreferences();
    // The sentinel is expected; no preference keys should appear.
    expect(Object.keys(localStorage)).toEqual([`${CURRENT}migrated:v1`]);
  });

  describe("when a key cannot be moved", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("leaves the flag unset so the next launch retries", () => {
      localStorage.setItem(`${LEGACY}grouping:v1`, "project");
      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("quota");
        });

      migrateLegacyPreferences();
      expect(localStorage.getItem(`${LEGACY}grouping:v1`)).toBe("project");
      expect(localStorage.getItem(`${CURRENT}migrated:v1`)).toBeNull();

      setItem.mockRestore();
      migrateLegacyPreferences();
      expect(localStorage.getItem(`${CURRENT}grouping:v1`)).toBe("project");
      expect(localStorage.getItem(`${CURRENT}migrated:v1`)).toBe("1");
    });
  });
});
