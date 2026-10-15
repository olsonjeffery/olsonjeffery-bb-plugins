// Settings page: section editor + spools accordion.
//
// Everything the sidebar exposes piecemeal (create sections, spool cards)
// lives together here with the ops the sidebar does not expose at all
// (rename/delete a section). Unfiled is pinned read-only, like the sidebar.
import {
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useSpools } from "./useSpools";
import type { Spool } from "./spoolStore";
import { UnspoolConfirmDialog } from "./UnspoolConfirmDialog";

/** useSpools declares the metadata subset it needs; the real client matches. */
type PanelSdk = Parameters<typeof useSpools>[0]["sdk"];

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
  const spoolStore = useSpools({
    threads: sidebar.threads,
    pluginId,
    sdk: sdk as unknown as PanelSdk,
  });

  const [sections, setSections] = useState<PluginSidebarSection[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmUnspoolId, setConfirmUnspoolId] = useState<string | null>(null);
  const [openSpools, setOpenSpools] = useState<ReadonlySet<string>>(new Set());
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
  const threadById = useMemo(
    () => new Map(sidebar.threads.map((thread: PluginSidebarThread) => [thread.id, thread])),
    [sidebar.threads],
  );
  const memberTitle = useCallback(
    (threadId: string) => {
      const row = threadById.get(threadId);
      return row?.displayTitle ?? row?.title ?? threadId;
    },
    [threadById],
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

  const toggleSpool = (spoolId: string) => {
    setOpenSpools((open) => {
      const next = new Set(open);
      if (next.has(spoolId)) next.delete(spoolId);
      else next.add(spoolId);
      return next;
    });
  };

  const startUnspool = (spool: Spool) => {
    setConfirmUnspoolId(spool.id);
  };

  const confirmedSpool = spoolStore.spools.find(
    (spool) => spool.id === (confirmUnspoolId ?? ""),
  );

  const spoolRows = () => (
    <div className="spooler-settings-list" data-testid="spooler-settings-spools">
      {spoolStore.spools.map((spool) => {
        const open = openSpools.has(spool.id);
        return (
          <div key={spool.id} className="spooler-settings-group">
            <button
              type="button"
              className="spooler-settings-group-toggle"
              aria-expanded={open}
              data-testid={`spooler-settings-spool:${spool.id}`}
              onClick={() => toggleSpool(spool.id)}
            >
              <span aria-hidden={true}>▸</span>
              <span>{spool.title}</span>
              <span className="spooler-settings-muted">
                {spool.members.length} thread{spool.members.length === 1 ? "" : "s"}
              </span>
            </button>
            <button
              type="button"
              className="spooler-settings-button spooler-settings-button-danger"
              data-testid={`spooler-settings-unspool:${spool.id}`}
              onClick={() => startUnspool(spool)}
            >
              Unspool…
            </button>
            {open ? (
              <ul className="spooler-settings-members">
                {spool.members.map((memberId) => (
                  <li key={memberId}>
                    <span title={memberId}>
                      {memberId === spool.leadThreadId ? "◆ " : ""}
                      {memberTitle(memberId)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {spoolStore.spools.length === 0 ? (
        <p className="spooler-settings-muted" data-testid="spooler-settings-no-spools">
          No spools yet — throw threads together from the sidebar.
        </p>
      ) : null}
    </div>
  );

  const sectionRows: (PluginSidebarSection | "unfiled")[] = [
    "unfiled",
    ...(sections ?? sidebar.sections),
  ];

  return (
    <div className="spooler-settings" data-status={spoolStore.status}>
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

      <div className="spooler-settings-block">
        <p className="spooler-settings-heading">Spools</p>
        {spoolRows()}
      </div>

      {confirmedSpool ? (
        <UnspoolConfirmDialog
          title={confirmedSpool.title}
          count={confirmedSpool.members.length}
          onConfirm={() => {
            setConfirmUnspoolId(null);
            void spoolStore
              .unspool(confirmedSpool.id)
              .then(() => toast.success("Spool unraveled."))
              .catch((cause: unknown) => toast.error(problem(cause)));
          }}
          onCancel={() => setConfirmUnspoolId(null)}
        />
      ) : null}
    </div>
  );
}
