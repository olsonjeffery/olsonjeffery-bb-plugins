import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import type { Persona } from "@/personas";
import { displayName } from "@/personas";

/**
 * The content-pane header shared by the persona settings screen and the
 * deep-link chat view: back affordance, persona identity, and the gear into
 * the settings screen. Deleting lives in the settings screen, not here.
 */
export function PersonaHeader({
  persona,
  onBack,
  onGoToPersonaPage,
  onOpenSettings,
}: {
  persona: Persona;
  onBack?: () => void;
  /** Omit when already on the persona's own page — the name renders as plain text. */
  onGoToPersonaPage?: () => void;
  /** Omit on chat views — settings live on the persona's settings screen. */
  onOpenSettings?: () => void;
}) {
  const subtitle = [persona.providerId, persona.model, persona.reasoningLevel]
    .filter((part) => part !== null && part !== "")
    .join(" · ");

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex shrink-0 items-center justify-center hover:bg-accent`}
        >
          <Icon name="ChevronLeft" aria-hidden />
        </button>
      )}
      <PersonaAvatar personaId={persona.id} emoji={persona.emoji} color={persona.color} size="sm" />
      <div className="min-w-0 flex-1">
        {onGoToPersonaPage === undefined ? (
          <p className="truncate text-sm font-medium">{displayName(persona)}</p>
        ) : (
          <button
            type="button"
            onClick={onGoToPersonaPage}
            className="truncate text-left text-sm font-medium hover:underline"
          >
            {displayName(persona)}
          </button>
        )}
        {subtitle === "" ? null : (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {onOpenSettings === undefined ? null : (
        <button
          type="button"
          aria-label="Edit persona settings"
          onClick={onOpenSettings}
          className={`${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} inline-flex shrink-0 items-center justify-center hover:bg-accent`}
        >
          <Icon name="Settings" aria-hidden />
        </button>
      )}
    </div>
  );
}
