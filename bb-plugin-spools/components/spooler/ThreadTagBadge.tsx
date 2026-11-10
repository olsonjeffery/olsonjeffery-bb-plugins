// One Thread Tags badge, drawn the way bb-plugin-thread-tags draws it: one
// label (an emoji or short text) on a solid colored chip whose text tone
// flips on the chip's luminance, and a single glyph rendering square. The
// metrics are numbers only (the row and the settings page wear the 16px
// small size), mirroring thread-tags' TagBadge at v0.1.0 — bb-plugin-spools
// is a reader and must not pull the other plugin's bundle in.
import type { CSSProperties } from "react";
import type { TagInfo } from "./threadTags";

/** One user-perceived glyph (one emoji, one letter) renders as a square. */
function isSingleGlyph(label: string): boolean {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter === undefined) {
    return [...label].length <= 1;
  }
  return (
    [...new Segmenter(undefined, { granularity: "grapheme" }).segment(label)]
      .length <= 1
  );
}

/** Black on bright chips, white on the rest — thread-tags' own rule. */
function foregroundFor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0726 * b!;
  return luminance > 0.4 ? "#111827" : "#ffffff";
}

const BADGE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  boxSizing: "border-box",
  height: 24,
  minWidth: 24,
  borderRadius: 6,
  padding: "0 6px",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "24px",
  whiteSpace: "nowrap",
  userSelect: "none",
} as const;

export function ThreadTagBadge({
  tag,
  small = false,
  title,
}: {
  tag: TagInfo;
  /** The 16px summary-box size (the row sub-head and the spool title bar). */
  small?: boolean;
  /** Optional tooltip text; the badge is decorative ink, never interactive. */
  title?: string;
}) {
  const sized: CSSProperties = small
    ? {
        ...BADGE_STYLE,
        height: 16,
        minWidth: 16,
        borderRadius: 4,
        // A single glyph renders as a square chip; text gets horizontal pad.
        padding: isSingleGlyph(tag.label) ? 0 : "0 4px",
        fontSize: 10,
        lineHeight: "16px",
      }
    : BADGE_STYLE;
  return (
    <span
      className="spooler-tag-badge"
      role="img"
      aria-label={`Tag: ${tag.label}`}
      title={title ?? tag.label}
      style={{
        ...sized,
        background: tag.color,
        color: foregroundFor(tag.color),
      }}
    >
      {tag.label}
    </span>
  );
}
