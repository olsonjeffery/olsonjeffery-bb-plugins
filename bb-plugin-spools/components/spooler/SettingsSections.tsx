// Settings page: the section editor.
//
// Everything the sidebar exposes piecemeal lives together here with the ops
// the sidebar does not expose at all (rename/delete a section) — plus the
// section color picker, mirroring the sidebar's per-section palette (the
// colors live in the same localStorage map, so both stay in sync). Unfiled is
// pinned read-only, like the sidebar. Spool management itself is fully
// covered by the sidebar's spool cards, so there is no spool list here.
//
// Controls reuse the sidebar's shadcn Button/Input and the exact
// SpoolerNewSection flow: hand-rolled bare <input>/<button> markup on this
// page rendered half-styled at best.
import {
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SpoolerNewSection } from "./SpoolerNewSection";
import {
  SECTION_COLOR_NONE,
  SECTION_COLOR_OPTIONS,
  colorSwatchFor,
  readSectionColorMap,
  sectionColorOption,
  writeSectionColorMap,
  type SectionColorMap,
} from "./sectionColors";
import { useThemeIsDark } from "./useThemeIsDark";

function problem(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

interface RenameDraft {
  sectionId: string;
  value: string;
}

export function SpoolsSettingsSection() {
  const sdk = useSdk();
  const sidebar = experimental_useSidebarThreads();
  const pluginId = experimental_usePluginId() || "spools";
  const isDark = useThemeIsDark();

  const [sections, setSections] = useState<PluginSidebarSection[] | null>(null);
  const [draft, setDraft] = useState<RenameDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [colorOpenId, setColorOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [colorMap, setColorMap] = useState<SectionColorMap>(() =>
    readSectionColorMap(),
  );

  const reloadSections = useCallback(() => {
    void (async () => {
      try {
        const rows = await sdk.threadSections.list();
        setSections(rows);
      } catch (cause) {
        toast.error(`Couldn’t load sections: ${problem(cause)}`);
      }
    })();
  }, [sdk]);

  // The settings page is not inside the sidebar's host-managed snapshot; read
  // the server directly so renames and deletes reflect immediately.
  useEffect(() => {
    reloadSections();
  }, [reloadSections]);

  const sectionById = useMemo(
    () => new Map((sections ?? sidebar.sections).map((section) => [section.id, section])),
    [sections, sidebar.sections],
  );
  const sectionCount = useCallback(
    (sectionId: string) =>
      sidebar.threads.filter((thread) => thread.sectionId === sectionId).length,
    [sidebar.threads],
  );

  const runSectionWrite = useCallback(
    async (label: string, write: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await write();
        toast.success(label);
      } catch (cause) {
        toast.error(problem(cause));
      } finally {
        setBusy(false);
        reloadSections();
      }
    },
    [busy, reloadSections],
  );

  const commitRename = useCallback(
    (existing: PluginSidebarSection) => {
      if (!draft) return;
      const trimmed = draft.value.trim();
      if (trimmed.length === 0) {
        setDraft(null);
        return;
      }
      void runSectionWrite(
        `Renamed ${existing.name} to "${trimmed}".`,
        () => sdk.threadSections.update({ id: existing.id, name: trimmed }),
      );
      setDraft(null);
      setConfirmDeleteId(null);
    },
    [draft, runSectionWrite, sdk],
  );

  /** Same storage the sidebar header menu writes; both stay in sync. */
  const applySectionColor = useCallback((sectionId: string, colorId: string) => {
    const next: SectionColorMap = { ...readSectionColorMap() };
    if (colorId === SECTION_COLOR_NONE) {
      delete next[sectionId];
    } else {
      next[sectionId] = colorId;
    }
    writeSectionColorMap(next);
    setColorMap(next);
    setColorOpenId(null);
  }, []);

  const sectionRows: (PluginSidebarSection | "unfiled")[] = [
    "unfiled",
    ...(sections ?? sidebar.sections),
  ];

  return (
    <div className="spooler-settings">
      <div className="spooler-settings-block" data-testid="spooler-settings-sections">
        <ul className="spooler-settings-list">
          {sectionRows.map((row) => {
            if (row === "unfiled") {
              return (
                <li key="unfiled" className="spooler-settings-row" data-testid="spooler-settings-section:unfiled">
                  <span>Unfiled</span>
                  <span className="spooler-settings-muted">default — read-only</span>
                </li>
              );
            }
            const section = row as PluginSidebarSection;
            const renaming = draft?.sectionId === section.id;
            const deleting = confirmDeleteId === section.id;
            const colorOpen = colorOpenId === section.id;
            const colorOption = sectionColorOption(colorMap, section.id);
            return (
              <li key={section.id} className="spooler-settings-row">
                {renaming ? (
                  <>
                    <Input
                      className="spooler-settings-input spooler-settings-rename-input"
                      data-testid={`spooler-settings-rename-input:${section.id}`}
                      value={draft?.value ?? ""}
                      onChange={(event) =>
                        setDraft({ sectionId: section.id, value: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename(section);
                        if (event.key === "Escape") setDraft(null);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-testid={`spooler-settings-rename-save:${section.id}`}
                      onClick={() => commitRename(section)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`spooler-settings-rename-cancel:${section.id}`}
                      onClick={() => setDraft(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="spooler-settings-swatch"
                      data-testid={`spooler-settings-swatch:${section.id}`}
                      title={colorOption ? `Color: ${colorOption.label}` : "Change color"}
                      aria-expanded={colorOpen}
                      onClick={() => setColorOpenId(colorOpen ? null : section.id)}
                    >
                      <span
                        className="spooler-settings-swatch-dot"
                        data-none={colorOption ? undefined : ""}
                        style={
                          colorOption
                            ? { background: colorSwatchFor(colorOption, isDark) }
                            : undefined
                        }
                      />
                    </button>
                    <button
                      type="button"
                      className="spooler-settings-section-name"
                      data-testid={`spooler-settings-section-name:${section.id}`}
                      onClick={() =>
                        setDraft({ sectionId: section.id, value: section.name })
                      }
                    >
                      {section.name}
                    </button>
                    <span className="spooler-settings-muted">
                      {sectionCount(section.id)} thread{sectionCount(section.id) === 1 ? "" : "s"}
                    </span>
                    {deleting ? (
                      <>
                        <span className="spooler-settings-muted">
                          Threads stay, unfiled.
                        </span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          data-testid={`spooler-settings-delete-go:${section.id}`}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            void runSectionWrite(
                              `Deleted section.`,
                              () => sdk.threadSections.delete({ id: section.id }),
                            );
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`spooler-settings-delete-no:${section.id}`}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`spooler-settings-rename:${section.id}`}
                          onClick={() =>
                            setDraft({ sectionId: section.id, value: section.name })
                          }
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          data-testid={`spooler-settings-delete:${section.id}`}
                          onClick={() => setConfirmDeleteId(section.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </>
                )}
                {colorOpen ? (
                  <div
                    className="spooler-settings-colorstrip"
                    data-testid={`spooler-settings-colorstrip:${section.id}`}
                  >
                    {SECTION_COLOR_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="spooler-settings-colorswatch"
                        data-testid={`spooler-settings-color:${section.id}:${option.id}`}
                        data-current={colorOption?.id === option.id ? "" : undefined}
                        title={`${option.label}${colorOption?.id === option.id ? " (current)" : ""}`}
                        aria-label={`${option.label}${colorOption?.id === option.id ? " (current)" : ""}`}
                        aria-pressed={colorOption?.id === option.id}
                        onClick={() => applySectionColor(section.id, option.id)}
                      >
                        <span
                          className="spooler-settings-swatch-dot"
                          style={{ background: colorSwatchFor(option, isDark) }}
                        />
                      </button>
                    ))}
                    <button
                      type="button"
                      className="spooler-settings-colorswatch spooler-settings-colorswatch-none"
                      data-testid={`spooler-settings-color:${section.id}:none`}
                      data-current={colorOption ? undefined : ""}
                      title="No color"
                      aria-label="No color"
                      aria-pressed={!colorOption}
                      onClick={() => applySectionColor(section.id, SECTION_COLOR_NONE)}
                    >
                      <Icon name="Ban" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {/* The same "New section" ghost-button-plus-form the sidebar uses. */}
        <SpoolerNewSection onCreated={() => reloadSections()} />
      </div>
    </div>
  );
}
