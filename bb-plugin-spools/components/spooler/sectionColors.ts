/**
 * Per-section sidebar styling, stored client-side in localStorage (the
 * server's section record carries only {id, name}).
 *
 * Colours are retired (the glance redesign made section identity icon-only):
 * stored colour values are ignored, not migrated — they simply never paint
 * again. The record keeps only its icon (`builtin:<IconName>` or a literal
 * pasted glyph); an absent icon renders no rail glyph at all.
 */

const SECTION_STYLE_KEY = "spooler-sidebar:section-style:v2";

/** Prefix that marks an icon value as a curated builtin icon id. */
export const SECTION_ICON_BUILTIN_PREFIX = "builtin:";

export interface SectionStyle {
  /** Stored but ignored: legacy installs keep their file, nothing reads it. */
  color?: string;
  /** `builtin:<IconName>` or a literal glyph, absent for "no icon". */
  icon?: string;
}

/** sectionId → style, as stored. Unknown fields are dropped on read. */
export type SectionStyleMap = Record<string, SectionStyle>;

function parseStored(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readSectionStyleMap(): SectionStyleMap {
  const stored = parseStored(SECTION_STYLE_KEY);
  if (stored === null) return {};
  const map: SectionStyleMap = {};
  for (const [sectionId, style] of Object.entries(stored)) {
    if (typeof style !== "object" || style === null) continue;
    const record = style as Record<string, unknown>;
    const output: SectionStyle = {};
    // `color` is read and deliberately dropped: section colours no longer
    // paint anywhere, so a stored palette id never survives a write.
    if (typeof record.icon === "string" && record.icon.trim()) {
      output.icon = record.icon;
    }
    map[sectionId] = output;
  }
  return map;
}

/** Event bus: any style write dispatches this on `window`, so a mounted
 *  sidebar repaints when an icon is picked elsewhere (the settings modal,
 *  the plugin settings section). A `storage` event covers writes from
 *  another document. */
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

/** Persist one section's icon (null clears it). */
export function writeSectionIcon(
  sectionId: string,
  icon: string | null,
): void {
  writeSectionStyleMap(mapWithStyle(sectionId, { icon: icon ?? undefined }));
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
