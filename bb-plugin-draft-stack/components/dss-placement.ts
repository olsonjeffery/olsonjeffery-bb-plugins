// Placement math for the DSS popup: the host owns the popup container (the
// composer's typeahead/mention-menu wrapper), so the popup component applies
// the outcome itself. "Up" wins whenever there is room for the preferred
// height on both sides; otherwise the roomier side hosts the popup and its
// height is clamped so the message box stays visible.
export type DssSide = "top" | "bottom";

export function computeDssPlacement(spaceAbove: number, spaceBelow: number, viewportHeight: number, rem: number): { side: DssSide; maxHeight: number } {
  const want = Math.min(viewportHeight * 0.6, 24 * rem);
  const side: DssSide =
    spaceAbove >= want ? "top"
      : spaceBelow >= want ? "bottom"
        : spaceAbove >= spaceBelow ? "top" : "bottom";
  const room = (side === "top" ? spaceAbove : spaceBelow) - 8;
  return { side, maxHeight: Math.max(96, Math.min(want, room)) };
}
