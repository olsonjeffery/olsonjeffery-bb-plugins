// Side-panel pickers driven by the plugin's quick-palette commands.
//
// The palette itself is host-rendered (app.commands.register in app.tsx) and
// can only run code — so the pick-and-commit UI lives in `threadPanelAction`
// slots that the commands open via `openPanel`. Both pickers reuse the
// spool model: "move to section" re-files a spool's members together when the
// thread belongs to one (spools move as a unit, mirroring the sidebar drag).
import { experimental_usePluginId, experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useState } from "react";
import type { PluginSidebarSection, PluginSidebarThread, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useSpools } from "./useSpools";

/** useSpools declares the metadata subset it needs; the real client matches. */
type PanelSdk = Parameters<typeof useSpools>[0]["sdk"];

function sectionLabel(section: PluginSidebarSection | null): string {
  return section?.name ?? "Unfiled";
}

function problem(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

interface PickerResult {
  kind: "done" | "error";
  label: string;
}

/** List row extracted so both pickers share the affordance. */
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

function ResultNote({ result }: { result: PickerResult | null }) {
  if (!result) return null;
  return (
    <p
      className={
        result.kind === "done" ? "spooler-palette-note spooler-palette-note-done" : "spooler-palette-note"
      }
      data-testid="spooler-palette-result"
    >
      {result.label}
    </p>
  );
}

export function MoveToSectionPanel(props: PluginThreadPanelProps) {
  const sdk = useSdk();
  const sidebar = experimental_useSidebarThreads();
  const pluginId = experimental_usePluginId() || "spools";
  const spoolStore = useSpools({
    threads: sidebar.threads,
    pluginId,
    sdk: sdk as unknown as PanelSdk,
  });
  const [result, setResult] = useState<PickerResult | null>(null);

  const threadById = new Map(
    sidebar.threads.map((thread: PluginSidebarThread) => [thread.id, thread] as const),
  );
  const target = props.threadId;

  const sections: (PluginSidebarSection | null)[] = [null, ...sidebar.sections];
  const currentSection = () => {
    const thread = target ? threadById.get(target) : undefined;
    return ((thread as { sectionId?: string | null } | undefined)?.sectionId ?? null) as string | null;
  };

  const move = (section: PluginSidebarSection | null) => {
    if (!target) return;
    const destination = section ? section.name : sectionLabel(null);
    // A spool's rows travel together everywhere else in the plugin; keep the
    // palette consistent. A plain thread moves alone.
    const spool = spoolStore.spoolFor(target);
    const ids = [...(spool ? spool.members : [target])].filter((id) => {
      const thread = threadById.get(id);
      const sectionId = ((thread as { sectionId?: string | null } | undefined)?.sectionId ?? null) as
        string | null;
      return thread && sectionId !== (section?.id ?? null);
    });
    if (ids.length === 0) {
      setResult({ kind: "done", label: `Already in ${destination}.` });
      return;
    }
    void Promise.allSettled(
      ids.map((id) => sdk.threads.update({ threadId: id, sectionId: section?.id ?? null })),
    ).then((settled) => {
      const failed = settled.filter((row) => row.status === "rejected").length;
      if (failed === ids.length) {
        const label = `Couldn’t move to ${destination}.`;
        setResult({ kind: "error", label });
        toast.error(label);
        return;
      }
      const suffix = spool ? ` spool (${ids.length} thread${ids.length === 1 ? "" : "s"})` : " thread";
      const label = `Moved${suffix} to ${destination}.`;
      setResult({ kind: "done", label });
      toast.success(label);
    });
  };

  return (
    <div className="spooler-palette" data-testid="spooler-move-to-section" data-status={spoolStore.status}>
      <p className="spooler-palette-heading">Move to section</p>
      {sidebar.status !== "ready" ? (
        <p className="spooler-palette-note">Loading…</p>
      ) : (
        <div className="spooler-palette-list" role="listbox">
          {sections.map((section) => (
            <PickerRow
              key={section?.id ?? "unfiled"}
              label={sectionLabel(section)}
              detail={currentSection() === (section?.id ?? null) ? "current" : undefined}
              testId={section ? `spooler-move-section:${section.id}` : "spooler-move-section:unfiled"}
              onSelect={() => move(section)}
            />
          ))}
        </div>
      )}
      <ResultNote result={result} />
    </div>
  );
}

export function ThrowOntoSpoolPanel(props: PluginThreadPanelProps) {
  const sdk = useSdk();
  const sidebar = experimental_useSidebarThreads();
  const pluginId = experimental_usePluginId() || "spools";
  const spoolStore = useSpools({
    threads: sidebar.threads,
    pluginId,
    sdk: sdk as unknown as PanelSdk,
  });
  const [result, setResult] = useState<PickerResult | null>(null);

  const target = props.threadId;
  const threadById = new Map(
    sidebar.threads.map((thread: PluginSidebarThread) => [thread.id, thread] as const),
  );
  const ownSpool = target ? spoolStore.spoolFor(target) : null;
  const targetRow = target ? threadById.get(target) : undefined;
  const targetTitle = (targetRow?.displayTitle ?? targetRow?.title ?? undefined) as string | undefined;

  const commit = (spoolId: string | null) => {
    if (!target) return;
    if (spoolId && ownSpool?.id === spoolId) {
      setResult({ kind: "done", label: "Already in that spool." });
      return;
    }
    void (spoolId
      ? spoolStore.throwOntoSpool(spoolId, target)
      : spoolStore.createSpoolFromThread(target)
    ).then(() => {
      const name = spoolId ? "spool" : "new spool";
      const label = `Threw thread onto ${name}.`;
      setResult({ kind: "done", label });
      toast.success(label);
    }).catch((cause: unknown) => {
      const label = `Couldn’t throw thread onto spool: ${problem(cause)}`;
      setResult({ kind: "error", label });
      toast.error(label);
    });
  };

  return (
    <div className="spooler-palette" data-testid="spooler-throw-onto-spool" data-status={spoolStore.status}>
      <p className="spooler-palette-heading">Throw onto spool</p>
      {sidebar.status !== "ready" || spoolStore.status !== "ready" ? (
        <p className="spooler-palette-note">Loading…</p>
      ) : (
        <div className="spooler-palette-list" role="listbox">
          <PickerRow
            label="New spool…"
            detail={targetTitle}
            testId="spooler-throw-spool:new"
            onSelect={() => commit(null)}
          />
          {spoolStore.spools.map((spool) => (
            <PickerRow
              key={spool.id}
              label={spool.title}
              detail={`${spool.members.length} thread${spool.members.length === 1 ? "" : "s"}`}
              testId={`spooler-throw-spool:${spool.id}`}
              onSelect={() => commit(spool.id)}
            />
          ))}
          {spoolStore.spools.length === 0 ? (
            <p className="spooler-palette-note">No existing spools.</p>
          ) : null}
        </div>
      )}
      <ResultNote result={result} />
    </div>
  );
}
