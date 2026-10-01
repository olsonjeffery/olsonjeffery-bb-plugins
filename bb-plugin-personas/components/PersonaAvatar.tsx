import { cn } from "@/lib/utils";
import { avatarTint, type PersonaColor } from "@/personas";

const SIZES = {
  sm: "size-8 text-base",
  md: "size-10 text-xl",
  lg: "size-12 text-2xl",
} as const;

export function PersonaAvatar({
  personaId,
  emoji,
  color = null,
  size = "md",
  className,
}: {
  personaId: string;
  emoji: string;
  /** The persona's chosen color; null = the stable hash-derived tint. */
  color?: PersonaColor | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        SIZES[size],
        avatarTint(personaId, color),
        className,
      )}
    >
      {emoji}
    </span>
  );
}
