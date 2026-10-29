import { beforeEach, describe, expect, it } from "vitest";
import {
  SECTION_COLOR_NONE,
  SECTION_COLOR_OPTIONS,
  colorSwatchFor,
  onSectionColorsChanged,
  parseSectionIcon,
  readSectionColorMap,
  readSectionStyleMap,
  sectionColorOption,
  sectionColorVars,
  writeSectionColor,
  writeSectionColorMap,
  writeSectionIcon,
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

  it("keeps icons when colors are rewritten, and colors when icons are set", () => {
    writeSectionColor("a", "green");
    writeSectionIcon("a", "builtin:Star");
    writeSectionColor("b", "teal");
    writeSectionIcon("c", "🧵");
    expect(readSectionStyleMap()).toEqual({
      a: { color: "green", icon: "builtin:Star" },
      b: { color: "teal" },
      c: { icon: "🧵" },
    });
    // Clearing the color leaves the icon; clearing the icon leaves the
    // color; an entry with nothing left disappears.
    writeSectionColor("a", null);
    expect(readSectionStyleMap().a).toEqual({ icon: "builtin:Star" });
    writeSectionIcon("b", null);
    expect(readSectionStyleMap().b).toEqual({ color: "teal" });
    writeSectionIcon("c", null);
    expect(readSectionStyleMap().c).toBeUndefined();
  });

  it("migrates the legacy color map into styles on read", () => {
    localStorage.setItem(
      "spooler-sidebar:section-colors:v1",
      JSON.stringify({ legacy: "gold" }),
    );
    expect(readSectionColorMap()).toEqual({ legacy: "gold" });
    expect(readSectionStyleMap()).toEqual({ legacy: { color: "gold" } });
    // A style write adopts the v2 file for good; the legacy file stays put.
    writeSectionIcon("legacy", "✅");
    expect(JSON.parse(localStorage.getItem("spooler-sidebar:section-style:v2") ?? "{}"))
      .toEqual({ legacy: { color: "gold", icon: "✅" } });
  });

  it("tokenizes icon values into builtin ids and pasted glyphs", () => {
    expect(parseSectionIcon("builtin:Sent")).toEqual({ kind: "builtin", name: "Sent" });
    expect(parseSectionIcon("🧵")).toEqual({ kind: "char", glyph: "🧵" });
    expect(parseSectionIcon("   ")).toBeNull();
    expect(parseSectionIcon(null)).toBeNull();
    expect(parseSectionIcon("builtin:")).toBeNull();
  });

  it("survives unreadable storage", () => {
    localStorage.setItem("spooler-sidebar:section-colors:v1", "{nope");
    expect(readSectionColorMap()).toEqual({});
    expect(() => writeSectionColorMap({ a: "red" })).not.toThrow();
  });

  it("variables swap with the theme", () => {
    const gold = sectionColorOption({ g: "gold" }, "g")!;
    const light = sectionColorVars(gold, false) as Record<string, string>;
    // One anchor: the header tone. Spool and thread tones derive in CSS.
    expect(light).toMatchObject({
      "--spooler-sec-anchor": gold.light,
      "--spooler-sec-fg": "#262626",
    });
    const dark = sectionColorVars(gold, true) as Record<string, string>;
    expect(dark).toMatchObject({
      "--spooler-sec-anchor": gold.dark,
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
