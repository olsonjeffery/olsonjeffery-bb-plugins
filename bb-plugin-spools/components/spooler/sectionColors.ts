import type { CSSProperties } from "react";

/**
 * Per-section sidebar styling, stored client-side in localStorage (the
 * server's section record carries only {id, name}).
 *
 * v2 stores a {color, icon} style per section; the previous v1 color map is
 * still read for anyone upgrading. Icons are either a builtin id written as
 * `builtin:<IconName>` or a literal pasted glyph (any single emoji/unicode
 * character); an absent icon renders no rail glyph at all.
 *
 * Each color option supplies a background anchor for both themes. The anchor
 * becomes the SECTION HEADER tone only; spool and thread tones derive from
 * it in CSS (`--spooler-sec-2` / `--spooler-sec-3`), so a color says one
 * word and gets a three-tier slab for free. Header text stays dark on light
 * anchors and light on dark ones — the contrast decision lives here, not in
 * CSS, so a color can never be picked with the wrong text on it.
 */

const SECTION_STYLE_KEY = "spooler-sidebar:section-style:v2";
const LEGACY_SECTION_COLORS_KEY = "spooler-sidebar:section-colors:v1";

/** Prefix that marks an icon value as a curated builtin icon id. */
export const SECTION_ICON_BUILTIN_PREFIX = "builtin:";

export interface SectionStyle {
  /** Palette id, absent for "no color". */
  color?: string;
  /** `builtin:<IconName>` or a literal glyph, absent for "no icon". */
  icon?: string;
}

/** sectionId → style, as stored. Unknown color ids are dropped on read. */
export type SectionStyleMap = Record<string, SectionStyle>;

export interface SectionColorOption {
  id: string;
  label: string;
  /** Section header anchor, light theme. */
  light: string;
  /** Same color, dark theme. */
  dark: string;
}

/** Text over a light anchor: near-black instead of pure black. */
export const SECTION_TEXT_LIGHT = "#262626";
/** Text over a dark anchor: soft white. */
export const SECTION_TEXT_DARK = "#f8f8f8";

/** `none` is reserved for the "no color" choice: it never appears in the map. */
export const SECTION_COLOR_NONE = "none";

export const SECTION_COLOR_OPTIONS: readonly SectionColorOption[] = [
  { id: "slate", label: "Slate", light: "#e3e7ee", dark: "#31363f" },
  { id: "brown", label: "Brown", light: "#eadbcc", dark: "#463527" },
  { id: "red", label: "Red", light: "#f4d9d6", dark: "#4a2a28" },
  { id: "orange", label: "Orange", light: "#f7e2cc", dark: "#4a3723" },
  { id: "gold", label: "Gold", light: "#f4e8c5", dark: "#463e1e" },
  { id: "green", label: "Green", light: "#dcead8", dark: "#2b422a" },
  { id: "teal", label: "Teal", light: "#d0e7e3", dark: "#284b47" },
  { id: "sky", label: "Sky", light: "#d5e5f4", dark: "#26394f" },
  { id: "indigo", label: "Indigo", light: "#d9dcf3", dark: "#353a5c" },
  { id: "violet", label: "Violet", light: "#e6def2", dark: "#3f2f5a" },
  { id: "pink", label: "Pink", light: "#f2dce6", dark: "#4a303c" },
];

const OPTIONS_BY_ID = new Map(
  SECTION_COLOR_OPTIONS.map((option) => [option.id, option]),
);

/** sectionId → colorId, as seen through the style map. Unknown ids dropped. */
export type SectionColorMap = Record<string, string>;

function parseStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** v1 color map, so a pre-existing install keeps its colors after upgrading. */
function legacyColorMap(): SectionColorMap | null {
  const raw = parseStored<Record<string, unknown>>(LEGACY_SECTION_COLORS_KEY);
  if (!raw) return null;
  const map: SectionColorMap = {};
  for (const [sectionId, colorId] of Object.entries(raw)) {
    if (typeof colorId === "string" && OPTIONS_BY_ID.has(colorId)) {
      map[sectionId] = colorId;
    }
  }
  return map;
}

export function readSectionStyleMap(): SectionStyleMap {
  const stored = parseStored<Record<string, unknown>>(SECTION_STYLE_KEY);
  if (stored === null) {
    // No v2 data yet: present the legacy colors as styles (read-only; the v1
    // file keeps working until the first style write adopts it for good).
    const legacy = legacyColorMap();
    if (!legacy) return {};
    const migrated: SectionStyleMap = {};
    for (const [sectionId, colorId] of Object.entries(legacy)) {
      migrated[sectionId] = { color: colorId };
    }
    return migrated;
    return migrated;
  }
  const map: SectionStyleMap = {};
  for (const [sectionId, style] of Object.entries(stored)) {
    if (typeof style !== "object" || style === null) continue;
    const record = style as Record<string, unknown>;
    const output: SectionStyle = {};
    if (typeof record.color === "string" && OPTIONS_BY_ID.has(record.color)) {
      output.color = record.color;
    }
    if (typeof record.icon === "string" && record.icon.trim()) {
      output.icon = record.icon;
    }
    map[sectionId] = output;
  }
  return map;
}

/** Event bus: any style write dispatches this on `window`, so a mounted
 *  sidebar repaints when a color or icon is picked elsewhere (the settings
 *  modal, the plugin settings section). A `storage` event covers writes
 *  from another document. */
export const SECTION_COLORS_EVENT = "spooler-section-colors-changed";

export function onSectionColorsChanged(callback: () => void): () => void {
  const onStorage = () => callback();
  window.addEventListener(SECTION_COLORS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SECTION_COLORS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

function compactStyle(style: SectionStyle): SectionStyle | null {
  const clean: SectionStyle = {};
  if (style.color && style.color !== SECTION_COLOR_NONE && OPTIONS_BY_ID.has(style.color)) {
    clean.color = style.color;
  }
  if (typeof style.icon === "string" && style.icon.trim()) clean.icon = style.icon;
  return Object.keys(clean).length === 0 ? null : clean;
}

export function writeSectionStyleMap(map: SectionStyleMap): void {
  const compact: SectionStyleMap = {};
  for (const [sectionId, style] of Object.entries(map)) {
    const clean = compactStyle(style);
    if (clean) compact[sectionId] = clean;
  }
  try {
    localStorage.setItem(SECTION_STYLE_KEY, JSON.stringify(compact));
    // Same window: tell the mounted sidebar directly (its state seeded from
    // this map at mount would otherwise keep stale values until reload).
    window.dispatchEvent(new CustomEvent(SECTION_COLORS_EVENT));
  } catch {
    // The choice just won't persist.
  }
}

function mapWithStyle(
  sectionId: string,
  style: SectionStyle,
): SectionStyleMap {
  const next = readSectionStyleMap();
  const clean = compactStyle(style);
  if (clean) next[sectionId] = clean;
  else delete next[sectionId];
  return next;
}

/* ------------------------------------------------------------------ */
/* Colors (v1-compatible surface)                                      */
/* ------------------------------------------------------------------ */

export function readSectionColorMap(): SectionColorMap {
  const style = readSectionStyleMap();
  const colors: SectionColorMap = {};
  for (const [sectionId, entry] of Object.entries(style)) {
    if (entry.color) colors[sectionId] = entry.color;
  }
  return colors;
}

export function writeSectionColorMap(colors: SectionColorMap): void {
  try {
    const desired = new Set(Object.keys(colors));
    // Start from the full style map so icons survive a color rewrite.
    const next: SectionStyleMap = {};
    for (const [sectionId, style] of Object.entries(readSectionStyleMap())) {
      next[sectionId] = style;
    }
    for (const sectionId of [
      ...new Set([...Object.keys(next), ...desired]),
    ]) {
      const style = next[sectionId] ?? {};
      const colorId = colors[sectionId] ?? SECTION_COLOR_NONE;
      next[sectionId] = {
        icon: style.icon,
        color: colorId === SECTION_COLOR_NONE ? undefined : colorId,
      };
    }
    writeSectionStyleMap(next);
  } catch {
    // The choice just won't persist.
  }
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/** Look up a section's icon value (`builtin:<icon>` or a literal glyph). */
export function sectionIconOf(
  styleMap: SectionStyleMap,
  sectionId: string | null | undefined,
): string | null {
  if (!sectionId) return null;
  return styleMap[sectionId]?.icon ?? null;
}

export function sectionColorOption(
  map: SectionColorMap,
  sectionId: string | null | undefined,
): SectionColorOption | null {
  if (!sectionId) return null;
  const option = OPTIONS_BY_ID.get(map[sectionId] ?? "");
  return option ?? null;
}

/** Persist one section's color (null clears it) without touching its icon. */
export function writeSectionColor(
  sectionId: string,
  colorId: string | null,
): void {
  const style = readSectionStyleMap()[sectionId] ?? {};
  if (colorId === null) {
    writeSectionStyleMap(mapWithStyle(sectionId, { icon: style.icon }));
    return;
  }
  writeSectionStyleMap(
    mapWithStyle(sectionId, { color: colorId, icon: style.icon }),
  );
}

/** Persist one section's icon (null clears it) without touching colors. */
export function writeSectionIcon(
  sectionId: string,
  icon: string | null,
): void {
  const style = readSectionStyleMap()[sectionId] ?? {};
  if (icon === null && !style.color) {
    writeSectionStyleMap(mapWithStyle(sectionId, {}));
    return;
  }
  writeSectionStyleMap(
    mapWithStyle(sectionId, { color: style.color, icon: icon ?? undefined }),
  );
}

/** Parse a stored icon value: a curated builtin id or a literal glyph.
 *  Returns null for empty/unknown values. */
export function parseSectionIcon(
  raw: string | null | undefined,
): { kind: "builtin"; name: string } | { kind: "char"; glyph: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith(SECTION_ICON_BUILTIN_PREFIX)) {
    const name = value.slice(SECTION_ICON_BUILTIN_PREFIX.length).trim();
    return name ? { kind: "builtin", name } : null;
  }
  return { kind: "char", glyph: value };
}

/** Swatch helpers for the Color picker: a dot per palette entry, with the
 *  currently painted one checked. */
export function colorSwatchFor(
  option: SectionColorOption,
  isDark: boolean,
): string {
  return isDark ? option.dark : option.light;
}

/** CSS variables one colored section needs, resolved for the active theme.
 *  The anchor becomes the section header tone (`--spooler-sec-1`); spool and
 *  thread tones derive from it in CSS, so nothing below the header needs to
 *  know the theme. Returns null only for the `none` choice so uncolored
 *  sections fall back to theme-neutral gray tokens in CSS. */
export function sectionColorVars(
  option: SectionColorOption,
  isDark: boolean,
): CSSProperties {
  const bg = isDark ? option.dark : option.light;
  return {
    "--spooler-sec-anchor": bg,
    "--spooler-sec-fg": isDark ? SECTION_TEXT_DARK : SECTION_TEXT_LIGHT,
  } as CSSProperties;
}
