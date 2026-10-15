// Centered overlay picker for the palette commands. PalettePanels' old
// right-hand panels were ported here: the pickers reuse the confirm-dialog
// visual system (backdrop + centered card) and present rows; commits go to
// the sidebar through the props (SpoolerThreadList owns the spool model).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Spool } from "./spoolStore";
import type { PaletteIntent } from "./paletteBus";

function sectionLabel(section: PluginSidebarSection | null): string {
  return section?.name ?? "Unfiled";
}

function PickerRow(args: {
  label: string;
  detail?: string;
  disabled?: boolean;
  onSelect(): void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="spooler-palette-row"
      disabled={args.disabled}
      data-testid={args.testId}
      onClick={args.onSelect}
    >
      <span className="spooler-palette-row-label">{args.label}</span>
      {args.detail ? <span className="spooler-palette-row-detail">{args.detail}</span> : null}
    </button>
  );
}

export interface PaletteOverlayProps {
  intent: PaletteIntent;
  threads: readonly PluginSidebarThread[];
  sections: readonly PluginSidebarSection[];
  spools: readonly Spool[];
  /** Spool metadata still loading: rows wait so a plain thread is never
   * mis-filed while spool membership is unknown. */
  loading?: boolean;
  onMove(section: PluginSidebarSection | null): void;
  onThrow(spoolId: string | null): void;
  onClose(): void;
}

export function PaletteOverlay(props: PaletteOverlayProps): React.ReactNode {
  const { intent, threads, sections, spools, loading } = props;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const threadById = new Map(
    threads.map((thread: PluginSidebarThread) => [thread.id, thread] as const),
  );
  const target = threadById.get(intent.threadId) ?? null;
  const ownSpool = spools.find((spool) => spool.members.includes(intent.threadId)) ?? null;
  const targetTitle =
    (target as { displayTitle?: string } | null)?.displayTitle ??
    target?.title ??
    undefined;

  const heading =
    intent.kind === "move-to-section" ? "Move to section…" : "Move to spool…";

  return createPortal(
    <div className="spooler-confirm-backdrop" onMouseDown={props.onClose}>
      <div
        className="spooler-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="spooler-palette" data-testid="spooler-palette-overlay">
          <p className="spooler-palette-heading">{heading}</p>
          {loading ? (
            <p className="spooler-palette-note">Loading…</p>
          ) : (
            <div className="spooler-palette-list" role="listbox">
              {intent.kind === "move-to-section" ? (
                [null, ...sections].map((section) => {
                  const destination = sectionLabel(section);
                  // A spool's rows travel together everywhere else in the
                  // plugin: the picker disables a destination that already
                  // holds every member (spool or plain thread).
                  const members = ownSpool ? ownSpool.members : [intent.threadId];
                  const sectionId = section?.id ?? null;
                  const stale = members.filter((id) => {
                    const thread = threadById.get(id);
                    return thread && (thread.sectionId ?? null) !== sectionId;
                  });
                  const current = ((target as { sectionId?: string | null } | null)?.sectionId ??
                    null) === sectionId;
                  return (
                    <PickerRow
                      key={section?.id ?? "unfiled"}
                      label={destination}
                      detail={current ? "current" : undefined}
                      disabled={stale.length === 0}
                      testId={
                        section
                          ? `spooler-move-section:${section.id}`
                          : "spooler-move-section:unfiled"
                      }
                      onSelect={() => props.onMove(section)}
                    />
                  );
                })
              ) : (
                <>
                  <PickerRow
                    label="New spool…"
                    detail={targetTitle}
                    testId="spooler-throw-spool:new"
                    onSelect={() => props.onThrow(null)}
                  />
                  {spools.map((spool) => (
                    <PickerRow
                      key={spool.id}
                      label={spool.title}
                      detail={`${spool.members.length} thread${spool.members.length === 1 ? "" : "s"}`}
                      testId={`spooler-throw-spool:${spool.id}`}
                      onSelect={() => {
                        if (ownSpool?.id === spool.id) {
                          toast.error("Already in that spool.");
                          return;
                        }
                        props.onThrow(spool.id);
                      }}
                    />
                  ))}
                  {spools.length === 0 ? (
                    <p className="spooler-palette-note">No existing spools.</p>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
