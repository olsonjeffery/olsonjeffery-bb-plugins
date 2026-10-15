import { beforeEach, describe, expect, it } from "vitest";
import {
  SECTION_COLOR_NONE,
  SECTION_COLOR_OPTIONS,
  colorSwatchFor,
  onSectionColorsChanged,
  readSectionColorMap,
  sectionColorOption,
  sectionColorVars,
  writeSectionColorMap,
} from "./sectionColors";
import { isDarkColor } from "./useThemeIsDark";

describe("section colors storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips known ids and drops unknown and none entries", () => {
    writeSectionColorMap({ a: "red", b: "not-a-color", c: SECTION_COLOR_NONE });
    expect(readSectionColorMap()).toEqual({ a: "red" });
    expect(sectionColorOption(readSectionColorMap(), "b")).toBeNull();
    expect(sectionColorOption(readSectionColorMap(), "c")).toBeNull();
    expect(sectionColorOption(readSectionColorMap(), "a")?.label).toBe("Red");
  });

  it("announces writes so a mounted sidebar can repaint on them", () => {
    const seen: string[] = [];
    const unsubscribe = onSectionColorsChanged(() => seen.push("changed"));
    writeSectionColorMap({ a: "red" });
    unsubscribe();
    // Only while subscribed: the event is not replayed to later listeners.
    writeSectionColorMap({});
    expect(seen).toEqual(["changed"]);
  });

  it("survives unreadable storage", () => {
    localStorage.setItem("spooler-sidebar:section-colors:v1", "{nope");
    expect(readSectionColorMap()).toEqual({});
    expect(() => writeSectionColorMap({ a: "red" })).not.toThrow();
  });

  it("variables swap with the theme", () => {
    const gold = sectionColorOption({ g: "gold" }, "g")!;
    expect(sectionColorVars(gold, false)).toMatchObject({
      "--spooler-sec-bg": gold.light,
      "--spooler-sec-fg": "#262626",
    });
    expect(sectionColorVars(gold, true)).toMatchObject({
      "--spooler-sec-bg": gold.dark,
      "--spooler-sec-fg": "#f8f8f8",
    });
    expect(colorSwatchFor(gold, true)).toBe(gold.dark);
  });

  it("palette ids are unique and generous", () => {
    const ids = SECTION_COLOR_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(SECTION_COLOR_NONE).toBe("none");
  });
});

describe("theme probe", () => {
  it("classifies resolved colors", () => {
    expect(isDarkColor("rgb(24, 26, 27)")).toBe(true);
    expect(isDarkColor("rgb(255 255 255)")).toBe(false);
    expect(isDarkColor("rgba(10, 10, 10, 0.3)")).toBe(false);
    expect(isDarkColor("")).toBe(false);
    expect(isDarkColor("not-a-color")).toBe(false);
  });
});
