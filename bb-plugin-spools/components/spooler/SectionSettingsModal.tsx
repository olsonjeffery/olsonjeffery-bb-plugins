import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Icon, isBuiltinIconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  SECTION_COLOR_NONE,
  SECTION_COLOR_OPTIONS,
  SECTION_ICON_BUILTIN_PREFIX,
  colorSwatchFor,
  onSectionColorsChanged,
  parseSectionIcon,
  readSectionStyleMap,
  writeSectionColor,
  writeSectionIcon,
} from "./sectionColors";
import { useThemeIsDark } from "./useThemeIsDark";

/** Curated builtin glyphs the picker offers (plus paste-anything below). */
const SECTION_ICON_CHOICES = [
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

const SAVE_DEBOUNCE_MS = 450;
/** How long the Saved marker lingers before fading back to idle. */
const SAVED_SETTLE_MS = 1600;

export type SectionSaveState = "idle" | "saving" | "saved" | "error";

/** One grapheme cluster count, ZWJ emoji groups counted as one where the
 *  engine supports it. */
function countGraphemes(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      });
      let count = 0;
      for (const _ of segmenter.segment(value)) count += 1;
      return count;
    } catch {
      // Fall through to the code-point count.
    }
  }
  return Array.from(value).length;
}

function problem(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Header/body gadget icons: tokenize a stored icon value for rendering.
 * Builtin ids render through the Icon pipeline; a pasted glyph renders as
 * plain text so any emoji/unicode character works.
 */
export function SectionIconGlyph({
  raw,
  className,
}: {
  raw: string | null;
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

/**
 * Section Settings: one modal for everything a section can be — name, color,
 * icon (curated set or any pasted emoji/unicode character). Every change
 * auto-saves: the name on a short debounce, color and icon the moment they
 * are picked; the single status slot beside Done reports it. Cancel discards
 * an uncommitted draft; already-saved edits stay. Done flushes a pending
 * draft and closes.
 */
export function SectionSettingsModal(props: {
  sectionId: string;
  initialName: string;
  onDone(): void;
}): ReactNode {
  const { sectionId, initialName, onDone } = props;
  const sdk = useSdk();
  const isDark = useThemeIsDark();

  const [name, setName] = useState(initialName);
  const [colorId, setColorId] = useState<string>(() => {
    const style = readSectionStyleMap()[sectionId];
    return style?.color ?? SECTION_COLOR_NONE;
  });
  const [iconRaw, setIconRaw] = useState<string>(() => readSectionStyleMap()[sectionId]?.icon ?? "");
  const [saveState, setSaveState] = useState<SectionSaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameTimerRef = useRef<number | null>(null);
  const iconTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  /** Authoritative initial name, so idle resets don't re-save the seed. */
  const seedNameRef = useRef(initialName);

  const resetSettle = () => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
  };
  const markSaved = () => {
    setSaveState("saved");
    setSaveMessage(null);
    resetSettle();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setSaveState((state) => (state === "saved" ? "idle" : state));
    }, SAVED_SETTLE_MS);
  };
  const markSaving = () => {
    resetSettle();
    setSaveState("saving");
    setSaveMessage(null);
  };
  const markError = (message: string) => {
    resetSettle();
    setSaveState("error");
    setSaveMessage(message);
  };

  // A style write from another surface (settings page, another tab) refreshes
  // the picks shown here.
  useEffect(
    () =>
      onSectionColorsChanged(() => {
        const style = readSectionStyleMap()[sectionId];
        setColorId(style?.color ?? SECTION_COLOR_NONE);
        setIconRaw(style?.icon ?? "");
      }),
    [sectionId],
  );

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    return () => {
      if (nameTimerRef.current !== null) clearTimeout(nameTimerRef.current);
      if (iconTimerRef.current !== null) clearTimeout(iconTimerRef.current);
      resetSettle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guard = (event: React.KeyboardEvent) => {
    // Section controls must not archive/pin the last keyboard-focused row.
    event.stopPropagation();
  };

  /** The name saves on a short debounce; Enter flushes it immediately. */
  const commitName = async (value: string, immediate = false): Promise<void> => {
    if (nameTimerRef.current !== null) {
      clearTimeout(nameTimerRef.current);
      nameTimerRef.current = null;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === seedNameRef.current) {
      setSaveState((state) => (state === "saving" ? "idle" : state));
      return;
    }
    if (!immediate) {
      markSaving();
      nameTimerRef.current = window.setTimeout(() => {
        nameTimerRef.current = null;
        void commitName(value, true);
      }, SAVE_DEBOUNCE_MS);
      return;
    }
    markSaving();
    try {
      await sdk.threadSections.update({ id: sectionId, name: trimmed });
      seedNameRef.current = trimmed;
      markSaved();
    } catch (cause) {
      markError(`Couldn’t save the name — ${problem(cause)}`);
    }
  };

  const applyColor = (choice: string) => {
    setColorId(choice);
    markSaving();
    try {
      writeSectionColor(
        sectionId,
        choice === SECTION_COLOR_NONE ? null : choice,
      );
      markSaved();
    } catch (cause) {
      markError(`Couldn’t set the color — ${problem(cause)}`);
    }
  };

  const applyIcon = (value: string) => {
    setIconRaw(value);
    if (iconTimerRef.current !== null) {
      clearTimeout(iconTimerRef.current);
      iconTimerRef.current = null;
    }
    markSaving();
    const trimmed = value.trim();
    if (!trimmed) {
      writeSectionIcon(sectionId, null);
      markSaved();
      return;
    }
    if (trimmed.startsWith(SECTION_ICON_BUILTIN_PREFIX)) {
      const name = trimmed.slice(SECTION_ICON_BUILTIN_PREFIX.length);
      if (isBuiltinIconName(name)) {
        writeSectionIcon(sectionId, SECTION_ICON_BUILTIN_PREFIX + name);
        markSaved();
      } else {
        markError("Unknown icon");
      }
      return;
    }
    if (countGraphemes(trimmed) !== 1) {
      markError("Use a single character");
      return;
    }
    writeSectionIcon(sectionId, trimmed);
    markSaved();
  };

  /** Word input: validate on a debounce so a save can't race a paste. */
  const scheduleIconChange = (value: string) => {
    setIconRaw(value);
    if (iconTimerRef.current !== null) clearTimeout(iconTimerRef.current);
    markSaving();
    iconTimerRef.current = window.setTimeout(() => {
      iconTimerRef.current = null;
      applyIcon(value);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushPending = () => {
    // Only name edits can still be pending at Done; icon debounce is short
    // enough that any open draft flushes with it too.
    void commitName(name, true);
    if (iconTimerRef.current !== null) {
      const pending = iconRaw;
      iconTimerRef.current = null;
      applyIcon(pending);
    }
  };

  const done = () => {
    flushPending();
    onDone();
  };

  const cancel = () => {
    // Discard drafts; anything already saved stays saved.
    if (nameTimerRef.current !== null) {
      clearTimeout(nameTimerRef.current);
      nameTimerRef.current = null;
    }
    if (iconTimerRef.current !== null) {
      clearTimeout(iconTimerRef.current);
      iconTimerRef.current = null;
    }
    onDone();
  };

  const headingIcon = iconRaw.trim() || null;

  return createPortal(
    <div
      className="spooler-modal-backdrop"
      onMouseDown={cancel}
      onKeyDown={guard}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Section settings — ${initialName}`}
        className="spooler-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
          if (
            event.key === "Enter" &&
            (event.target as HTMLElement).tagName === "INPUT"
          ) {
            event.preventDefault();
            done();
          }
        }}
      >
        <header className="spooler-modal-head">
          <span className="spooler-modal-head-icon">
            <SectionIconGlyph raw={headingIcon} />
          </span>
          <span className="spooler-modal-title">Section settings</span>
        </header>
        <div className="spooler-modal-body">
          <div className="spooler-modal-field">
            <label
              className="spooler-modal-label"
              htmlFor="spooler-section-name"
            >
              Name
            </label>
            <input
              ref={nameInputRef}
              id="spooler-section-name"
              className="spooler-modal-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                void commitName(event.target.value);
              }}
              aria-label="Section name"
              placeholder={initialName}
              maxLength={200}
              onKeyDown={guard}
            />
          </div>
          <div className="spooler-modal-field">
            <span className="spooler-modal-label">Color</span>
            <div className="spooler-swatch-row" role="radiogroup" aria-label="Section color">
              {SECTION_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={colorId === option.id}
                  aria-label={option.label}
                  className={cn(
                    "spooler-swatch",
                    colorId === option.id && "spooler-swatch-on",
                  )}
                  style={{ background: colorSwatchFor(option, isDark) }}
                  onClick={() => applyColor(option.id)}
                />
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={colorId === SECTION_COLOR_NONE}
                aria-label="No color"
                title="No color"
                className={cn(
                  "spooler-swatch spooler-swatch-none",
                  colorId === SECTION_COLOR_NONE && "spooler-swatch-on",
                )}
                onClick={() => applyColor(SECTION_COLOR_NONE)}
              >
                <Icon name="X" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="spooler-modal-field">
            <span className="spooler-modal-label">
              Icon — select or paste any emoji / unicode
            </span>
            <div className="spooler-icon-grid" role="radiogroup" aria-label="Section icon">
              {SECTION_ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={iconRaw === SECTION_ICON_BUILTIN_PREFIX + choice}
                  aria-label={choice}
                  title={choice}
                  className={cn(
                    "spooler-icon-cell",
                    iconRaw === SECTION_ICON_BUILTIN_PREFIX + choice &&
                      "spooler-icon-cell-on",
                  )}
                  onClick={() => {
                    applyIcon(SECTION_ICON_BUILTIN_PREFIX + choice);
                  }}
                >
                  <Icon name={choice} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={
                  iconRaw === "" || iconRaw === SECTION_ICON_BUILTIN_PREFIX
                }
                aria-label="No icon"
                title="No icon"
                className={cn(
                  "spooler-icon-cell spooler-icon-cell-none",
                  (iconRaw === "" || iconRaw === SECTION_ICON_BUILTIN_PREFIX) &&
                    "spooler-icon-cell-on",
                )}
                onClick={() => applyIcon("")}
              >
                <Icon name="X" aria-hidden="true" />
              </button>
            </div>
            <input
              className="spooler-icon-input"
              value={
                iconRaw.startsWith(SECTION_ICON_BUILTIN_PREFIX) ? "" : iconRaw
              }
              onChange={(event) => scheduleIconChange(event.target.value)}
              aria-label="Section icon (paste any emoji or unicode character)"
              placeholder="🚀"
              maxLength={16}
              spellCheck={false}
              onKeyDown={guard}
            />
          </div>
        </div>
        <footer className="spooler-modal-foot">
          <span
            className="spooler-save-state"
            data-state={saveState || undefined}
            role="status"
            aria-live="polite"
          >
            {saveState === "saving" ? (
              <>
                <span className="spooler-save-spinner" aria-hidden="true" />
                Saving…
              </>
            ) : saveState === "saved" ? (
              <>
                <span className="spooler-save-check" aria-hidden="true">
                  ✓
                </span>
                Saved
              </>
            ) : saveState === "error" ? (
              <>
                <span className="spooler-save-error-dot" aria-hidden="true">
                  ✕
                </span>
                {saveMessage ?? "Couldn’t save"}
              </>
            ) : null}
          </span>
          <button
            type="button"
            className="spooler-modal-btn spooler-modal-btn-ghost"
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="spooler-modal-btn spooler-modal-btn-done"
            onClick={done}
          >
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
