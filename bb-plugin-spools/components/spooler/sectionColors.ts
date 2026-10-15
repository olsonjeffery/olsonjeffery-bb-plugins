import type { CSSProperties } from "react";

/**
 * Named colors a sidebar section can be painted with (Group By Section view
 * only). Colors persist per device in localStorage — the server's section
 * record carries only {id, name}, so there is nowhere else to put it.
 *
 * Each entry supplies a background for both themes: a softened pastel for the
 * light sidebar and a deepened tone for the dark one. Text stays black on the
 * light tints and white on the deep tones — the contrast decision lives here,
 * not in CSS, so a color can never be picked with the wrong text on it.
 */

const SECTION_COLORS_KEY = "spooler-sidebar:section-colors:v1";

export interface SectionColorOption {
  id: string;
  label: string;
  /** Sidebar header / drawer background, light theme. */
  light: string;
  /** Same color, dark theme. */
  dark: string;
}

/** Text over a light variant: near-black instead of pure black. */
export const SECTION_TEXT_LIGHT = "#262626";
/** Text over a dark variant: soft white. */
export const SECTION_TEXT_DARK = "#f8f8f8";

/** `none` is reserved for the "no color" choice: it never appears in the CSS map. */
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

/** sectionId → colorId, as stored. Unknown ids are dropped on read. */
export type SectionColorMap = Record<string, string>;

export function readSectionColorMap(): SectionColorMap {
  try {
    const raw = localStorage.getItem(SECTION_COLORS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: SectionColorMap = {};
    for (const [sectionId, colorId] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof colorId !== "string") continue;
      if (colorId === SECTION_COLOR_NONE) continue;
      if (OPTIONS_BY_ID.has(colorId)) map[sectionId] = colorId;
    }
    return map;
  } catch {
    return {};
  }
}

export function writeSectionColorMap(map: SectionColorMap): void {
  try {
    const compact: SectionColorMap = {};
    for (const [sectionId, colorId] of Object.entries(map)) {
      if (colorId !== SECTION_COLOR_NONE && OPTIONS_BY_ID.has(colorId)) {
        compact[sectionId] = colorId;
      }
    }
    localStorage.setItem(SECTION_COLORS_KEY, JSON.stringify(compact));
  } catch {
    // The choice just won't persist.
  }
}

/** Look up the option painted on a section, or null when it is uncolored. */
export function sectionColorOption(
  map: SectionColorMap,
  sectionId: string | null | undefined,
): SectionColorOption | null {
  if (!sectionId) return null;
  const option = OPTIONS_BY_ID.get(map[sectionId] ?? "");
  return option ?? null;
}

/** Swatch helpers for the Change Color menu: a dot per palette entry, with
 *  the currently painted one checked. */
export function colorSwatchFor(
  option: SectionColorOption,
  isDark: boolean,
): string {
  return isDark ? option.dark : option.light;
}

/** CSS variables one colored section needs, resolved for the active theme.
 *  Returns null for the `none` choice so uncolored sections stay plain. */
export function sectionColorVars(
  option: SectionColorOption,
  isDark: boolean,
): CSSProperties | null {
  const bg = isDark ? option.dark : option.light;
  if (!bg) return null;
  return {
    "--spooler-sec-bg": bg,
    "--spooler-sec-fg": isDark ? SECTION_TEXT_DARK : SECTION_TEXT_LIGHT,
  } as CSSProperties;
}
