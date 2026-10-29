import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { parseSectionIcon } from "./sectionColors";

/** Curated builtin glyphs the picker offers; anything pasted below the grid
 *  completes the set. Should never include the section toggle glyphs. */
export const SECTION_ICON_CHOICES = [
  "Sent",
  "Beaker",
  "Zap",
  "Bug",
  "Palette",
  "Globe",
  "Settings",
  "Folder02",
  "Star",
  "Pin",
  "Layers",
  "Fork",
  "GitBranch",
  "Clock",
  "Edit",
  "Inbox",
] as const;

/** Renders a stored icon value (`builtin:<IconName>` or a literal pasted
 *  glyph). Null-safe: an unset icon renders nothing — the redesigned
 *  section header has retired the old universal `#` glyph. */
export function SectionIconGlyph({
  raw,
  className,
}: {
  raw: string | null | undefined;
  className?: string;
}): ReactNode {
  const icon = parseSectionIcon(raw);
  if (!icon) return null;
  if (icon.kind === "builtin") {
    return <Icon name={icon.name} className={className} aria-hidden={true} />;
  }
  return (
    <span className={className} aria-hidden="true">
      {icon.glyph}
    </span>
  );
}
