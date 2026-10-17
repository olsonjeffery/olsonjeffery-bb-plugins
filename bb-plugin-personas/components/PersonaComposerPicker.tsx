// The persona inline action on the New Thread composer: a robot-icon button
// (always the robot — the chip in the draft is the state) that opens a
// host-managed popup listing the published personas. Choosing one inserts or
// replaces THE persona mention pill in the composer's draft; "No persona"
// removes it. The pill travels with the submitted message, and the server's
// dispatch hook binds the new thread to its persona.
import {
  useBbNavigate,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import {
  personaPillsOf,
  pillAddedText,
  stripPersonaPills,
} from "@/components/persona-pill";
import { PANEL_PATH } from "@/components/panel-path";
import {
  displayName,
  MENTION_PROVIDER_ID,
  pillLabel,
  type Persona,
} from "@/personas";
import { cn } from "@/lib/utils";

/** The popup id inside this plugin's composer customization. */
export const PERSONA_PICKER_POPUP_ID = "personas-picker";

/**
 * The robot inline icon, drawn with currentColor so it follows the button's
 * tone the way the host's own glyph buttons do.
 */
export function PersonaRobotGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M13 7H11C8.19108 7 6.78661 7 5.77772 7.67412C5.34096 7.96596 4.96596 8.34096 4.67412 8.77772C4 9.78661 4 11.1911 4 14C4 16.8089 4 18.2134 4.67412 19.2223C4.96596 19.659 5.34096 20.034 5.77772 20.3259C6.78661 21 8.19108 21 11 21H13C15.8089 21 17.2134 21 18.2223 20.3259C18.659 20.034 19.034 19.659 19.3259 19.2223C20 18.2134 20 16.8089 20 14C20 11.1911 20 9.78661 19.3259 8.77772C19.034 8.34096 18.659 7.96596 18.2223 7.67412C17.2134 7 15.8089 7 13 7Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4 14H2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M10 17H14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M22 14H20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M15 11V13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M9 11V13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M12 7C12 5.11438 12 4.17157 11.4142 3.58579C10.8284 3 9.88562 3 8 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle
        cx="15"
        cy="3"
        r="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * The inline-action chrome: an icon-only button in the composer's action row,
 * rendered ahead of the native voice/submit controls on every new-thread
 * composer (and unavailable on them in compact layout — the host's own
 * rule). The persona state lives in the pill, so the button keeps the robot
 * even while one is armed; `aria-pressed` is the only operator reflection.
 */
export function PersonaInlineAction() {
  const composer = useComposer();
  const armed = personaPillsOf(composer.draft).length > 0;
  return (
    <button
      type="button"
      aria-label="Select persona for this session"
      aria-pressed={armed}
      title="Select persona for this session"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={composer.isSubmitting}
      onClick={() => {
        if (!composer.experimental_openPopup(PERSONA_PICKER_POPUP_ID)) {
          toast.error("The persona picker is unavailable here.");
        }
      }}
    >
      <PersonaRobotGlyph className="size-4.5" />
    </button>
  );
}

/** Removes the chip (leaving everything else in the draft alone). */
function disarm(composer: PluginComposerApi): void {
  const stripped = stripPersonaPills(composer.draft);
  if (stripped !== null) composer.replace(stripped);
  composer.experimental_closePopup();
}

/**
 * Replaces whatever chip the draft holds with `persona`'s, then — matching
 * the old persona-composer open behavior — seeds the persona's Default User
 * Message when the draft holds nothing but the chip.
 */
function armPersona(composer: PluginComposerApi, persona: Persona): void {
  const stripped = stripPersonaPills(composer.draft);
  const textAfterStrip = pillAddedText(composer.draft);
  if (stripped !== null) composer.replace(stripped);
  composer.insert(
    { provider: MENTION_PROVIDER_ID, id: persona.id, label: pillLabel(persona) },
    // Inline at the very end: the chip reads as part of the sentence being
    // typed, never as a paragraph of its own.
    { at: "end" },
  );
  const seed = persona.defaultUserMessage.trim();
  if (textAfterStrip.trim().length === 0 && seed.length > 0) {
    composer.insert(`\n${seed}`, { at: "end" });
  }
}

/**
 * The host-managed popup: a row per published persona (colored avatar +
 * name, the chip's persona checked), a "No persona" row whenever a chip is
 * present, and a link to the plugin page for managing the list. The host owns
 * placement, dismissal, and focus restoration; this component owns content.
 */
export function PersonaPickerPopup() {
  const composer = useComposer();
  const navigate = useBbNavigate();
  const rpc = usePersonasRpc();
  const { data, error } = useQuery(() => rpc.call("listPersonas", null), "pick");
  const pills = personaPillsOf(composer.draft);
  const armedId = pills[0]?.itemId;

  const rows = (data?.personas ?? []).filter(
    (persona) => persona.status === "published",
  );

  return (
    <div
      className="flex max-h-72 flex-col overflow-y-auto"
      data-testid="personas-picker-popup"
    >
      {error !== null ? (
        <p className="px-2 py-3 text-sm text-destructive">{error}</p>
      ) : null}
      {pills.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => disarm(composer)}
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate">
              No persona — remove the chip
            </span>
          </button>
          <div className="my-1 h-px bg-border" />
        </>
      ) : null}
      {rows.length === 0 && error === null ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          No published personas yet.
        </p>
      ) : (
        rows.map((persona) => (
          <button
            key={persona.id}
            type="button"
            aria-pressed={armedId === persona.id}
            className={cn(
              "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
              armedId === persona.id && "bg-accent/60",
            )}
            onClick={() => {
              armPersona(composer, persona);
              composer.experimental_closePopup();
            }}
          >
            <PersonaAvatar
              personaId={persona.id}
              emoji={persona.emoji}
              color={persona.color}
              size="sm"
              className="size-5 rounded-sm text-xs"
            />
            <span className="min-w-0 flex-1 truncate">{displayName(persona)}</span>
          </button>
        ))
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        onClick={() => {
          composer.experimental_closePopup();
          navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
        }}
        className="rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Manage personas…
      </button>
    </div>
  );
}
