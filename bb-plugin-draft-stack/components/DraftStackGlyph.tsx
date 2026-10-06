// The Draft Stack glyph: an outlined hand holding a pencil in front of a
// hamburger stack. The stack lines sit behind at reduced opacity for the
// color offset; everything else draws in full currentColor, so the mark
// tints like any bb icon.
export function DraftStackGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* the stack, behind (color offset: half strength) */}
      <g opacity={0.45} strokeWidth={1.7}>
        <path d="M4 4.5h8.5M4 8h8.5M4 11.5h6.5" />
      </g>
      {/* the pencil, held diagonally */}
      <g strokeWidth={1.6}>
        <path d="M12.1 11.2 17.9 5.4a1.5 1.5 0 0 1 2.1 2.1l-5.8 5.8-3.4.5.5-3.4Z" />
        <path d="m16.7 6.6 1.9 1.9" />
      </g>
      {/* the hand cupping the pencil */}
      <g strokeWidth={1.6}>
        <path d="M4.2 15.1c0-1.9 1.5-3.1 3.4-3.1h2.6l2.1 2.1" />
        <path d="M4.2 15.1c0 2.7 2.2 4.9 4.9 4.9h4.1c1.7 0 2.8-1 2.8-2.4 0-1.1-.8-1.9-1.9-2.1" />
        <path d="M7.3 17.6h3.9" />
      </g>
    </svg>
  );
}
