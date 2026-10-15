// Settings page: the section editor.
//
// Everything the sidebar exposes piecemeal lives together here with the ops
// the sidebar does not expose at all (rename/delete a section). Unfiled is
// pinned read-only, like the sidebar. Spool management itself is fully covered
// by the sidebar's spool cards, so there is no spool list here.
import {
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

function problem(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

interface Draft {
  kind: "new" | "rename";
  sectionId: string | null;
  value: string;
}

function sectionButton(args: {
  label: string;
  busy?: boolean;
  variant?: "default" | "danger";
  onClick(): void;
  testId: string;
}) {
  const classes = ["spooler-settings-button"];
  if (args.variant === "danger") classes.push("spooler-settings-button-danger");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={args.busy}
      onClick={args.onClick}
      data-testid={args.testId}
    >
      {args.label}
    </button>
  );
}

export function SpoolsSettingsSection() {
  const sdk = useSdk();
  const sidebar = experimental_useSidebarThreads();
  const pluginId = experimental_usePluginId() || "spools";

  const [sections, setSections] = useState<PluginSidebarSection[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const commitDraft = useCallback(
    (existing: PluginSidebarSection | null) => {
      if (!draft) return;
      const trimmed = draft.value.trim();
      if (trimmed.length === 0) return;
      void runSectionWrite(
        existing
          ? `Renamed ${existing.name} to "${trimmed}".`
          : `Created section "${trimmed}".`,
        existing
          ? () => sdk.threadSections.update({ id: existing.id, name: trimmed })
          : () => sdk.threadSections.create({ name: trimmed }),
      );
      setDraft(null);
      setConfirmDeleteId(null);
    },
    [draft, runSectionWrite, sdk],
  );

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
            const renaming = draft?.kind === "rename" && draft.sectionId === section.id;
            const deleting = confirmDeleteId === section.id;
            return (
              <li key={section.id} className="spooler-settings-row">
                {renaming ? (
                  <>
                    <input
                      className="spooler-settings-input"
                      data-testid={`spooler-settings-rename-input:${section.id}`}
                      value={draft?.value ?? ""}
                      onChange={(event) =>
                        setDraft({ kind: "rename", sectionId: section.id, value: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitDraft(section);
                        if (event.key === "Escape") setDraft(null);
                      }}
                    />
                    {sectionButton({
                      label: "Save",
                      busy,
                      testId: `spooler-settings-rename-save:${section.id}`,
                      onClick: () => commitDraft(section),
                    })}
                    {sectionButton({
                      label: "Cancel",
                      testId: `spooler-settings-rename-cancel:${section.id}`,
                      onClick: () => setDraft(null),
                    })}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="spooler-settings-section-name"
                      data-testid={`spooler-settings-section-name:${section.id}`}
                      onClick={() =>
                        setDraft({ kind: "rename", sectionId: section.id, value: section.name })
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
                        {sectionButton({
                          label: "Delete",
                          busy,
                          variant: "danger",
                          testId: `spooler-settings-delete-go:${section.id}`,
                          onClick: async () => {
                            setConfirmDeleteId(null);
                            await runSectionWrite(
                              `Deleted section.`,
                              () => sdk.threadSections.delete({ id: section.id }),
                            );
                          },
                        })}
                        {sectionButton({
                          label: "Keep",
                          testId: `spooler-settings-delete-no:${section.id}`,
                          onClick: () => setConfirmDeleteId(null),
                        })}
                      </>
                    ) : (
                      <>
                        {sectionButton({
                          label: "Rename",
                          testId: `spooler-settings-rename:${section.id}`,
                          onClick: () =>
                            setDraft({ kind: "rename", sectionId: section.id, value: section.name }),
                        })}
                        {sectionButton({
                          label: "Delete",
                          variant: "danger",
                          testId: `spooler-settings-delete:${section.id}`,
                          onClick: () => setConfirmDeleteId(section.id),
                        })}
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="spooler-settings-row spooler-settings-newrow">
          <input
            className="spooler-settings-input"
            data-testid="spooler-settings-new-input"
            placeholder="New section name"
            value={draft?.kind === "new" ? draft.value : ""}
            onChange={(event) => setDraft({ kind: "new", sectionId: null, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft(null);
              if (event.key === "Escape") setDraft(null);
            }}
          />
          {sectionButton({
            label: "Create section",
            busy,
            testId: "spooler-settings-new-create",
            onClick: () => void commitDraft(null),
          })}
        </div>
      </div>
    </div>
  );
}
