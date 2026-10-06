// The Draft Stack settings page: the whole stack, TOP FIRST, with drag and
// keyboard reordering, per-entry delete, downloadable attachment links, a
// clear-everything action, and an "Edit raw JSON" expander backed by the
// arbitrary-rewrite RPC.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useDraftStack } from "@/components/use-draft-stack";
import { relativeSavedAt } from "@/draft-stack";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { StackEntry } from "@/server";

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatBytes(sizeBytes: number | undefined): string | null {
  if (sizeBytes === undefined) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The attachment content URL: project attachments serve by path query. */
function attachmentHref(
  entry: StackEntry,
  path: string,
): string | null {
  if (entry.projectId === null) return null;
  return `/api/v1/projects/${encodeURIComponent(entry.projectId)}/attachments/content?path=${encodeURIComponent(path)}`;
}

function AttachmentChip({ entry, name, path, sizeBytes }: { entry: StackEntry; name: string; path: string; sizeBytes?: number }) {
  const href = attachmentHref(entry, path);
  const size = formatBytes(sizeBytes);
  const label = size === null ? name : `${name} (${size})`;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
      title={path}
    >
      <Icon name="FileAttachment" aria-hidden className="size-3 shrink-0" />
      {href === null ? (
        <span className="truncate">{label}</span>
      ) : (
        <a
          href={href}
          download={name}
          className="truncate underline decoration-border underline-offset-2 hover:text-foreground"
        >
          {label}
        </a>
      )}
    </span>
  );
}

function StackRow({
  entry,
  topFirstIndex,
  totalCount,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  entry: StackEntry;
  /** 0 for the entry shown first — the top of the stack. */
  topFirstIndex: number;
  totalCount: number;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex items-start gap-2 px-3 py-2.5",
        isDragging && "opacity-40",
      )}
    >
      <span
        aria-hidden
        className="mt-1 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to reorder"
      >
        <Icon name="DragDropVertical" className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {topFirstIndex === 0 ? "top" : `#${topFirstIndex + 1}`}
          </span>
          <span>{relativeSavedAt(entry.createdAt, Date.now())}</span>
          {entry.mentions.length > 0 ? <span>@{entry.mentions.length}</span> : null}
        </p>
        <p
          className={cn(
            "mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-sm",
            entry.text === "" && "italic text-muted-foreground",
          )}
        >
          {entry.text === "" ? "(no text — attachments only)" : entry.text}
        </p>
        {entry.attachments.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {entry.attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.path}
                entry={entry}
                name={attachment.name}
                path={attachment.path}
                sizeBytes={attachment.sizeBytes}
              />
            ))}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <span className="sr-only">
          {topFirstIndex + 1} of {totalCount}
        </span>
        <Button icon="ChevronUp" label={`Move entry ${topFirstIndex + 1} up (toward the top of the stack)`} disabled={topFirstIndex === 0} onClick={onMoveUp} />
        <Button icon="ChevronDown" label={`Move entry ${topFirstIndex + 1} down (toward the bottom of the stack)`} disabled={topFirstIndex === totalCount - 1} onClick={onMoveDown} />
        <Button icon="Trash2" label={`Delete entry ${topFirstIndex + 1}`} onClick={onDelete} destructive />
      </div>
    </li>
  );
}

function Button({
  icon,
  label,
  disabled,
  destructive,
  onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      <Icon name={icon} aria-hidden className="size-3.5" />
    </button>
  );
}

export function DraftStackSettings() {
  const { rpc, stack, error, reload } = useDraftStack();
  const entries = stack ?? [];
  // Display order: top first. Stored index = entries.length - 1 - display index.
  const topFirst = [...entries].reverse();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isEditingRaw, setIsEditingRaw] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function run(work: () => Promise<void>) {
    return () => {
      if (isBusy) return;
      setIsBusy(true);
      void work().finally(() => setIsBusy(false));
    };
  }

  function moveTo(entryId: string, storedIndex: number) {
    void rpc
      .call("moveEntry", { entryId, toIndex: storedIndex })
      .then(reload, (cause) => toast.error(describeError(cause)));
  }

  function openRawEditor() {
    setRawJson(JSON.stringify(entries, null, 2));
    setIsEditingRaw(true);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function applyRaw() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      toast.error("That is not valid JSON");
      return;
    }
    if (!Array.isArray(parsed)) {
      toast.error("The stack is a JSON array — the top-level value must be [ … ]");
      return;
    }
    void rpc
      .call("rewriteStack", { stack: parsed })
      .then((result) => {
        toast.success(
          `Applied: ${result.stack.length} entr${result.stack.length === 1 ? "y" : "ies"} kept`,
        );
        setIsEditingRaw(false);
        reload();
      }, describeError)
      .catch((cause) => toast.error(describeError(cause)));
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card">
        {error === null ? null : (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {stack === null ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading the stack…</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            The stack is empty. Push a draft from the composer’s stack button or “Push to Draft Stack” in the command palette.
          </p>
        ) : (
          <ul
            className="divide-y divide-border"
            onDragEnd={() => setDraggingId(null)}
          >
            {topFirst.map((entry, displayIndex) => (
              <StackRow
                key={entry.id}
                entry={entry}
                topFirstIndex={displayIndex}
                totalCount={entries.length}
                isDragging={draggingId === entry.id}
                onDragStart={() => setDraggingId(entry.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingId !== null && draggingId !== entry.id) {
                    moveTo(draggingId, entries.length - 1 - displayIndex);
                  }
                  setDraggingId(null);
                }}
                onMoveUp={() => moveTo(entry.id, entries.length - displayIndex)}
                onMoveDown={() => moveTo(entry.id, entries.length - displayIndex - 2)}
                onDelete={run(async () => {
                  await rpc.call("removeEntry", { entryId: entry.id });
                  toast.success("Entry removed");
                  reload();
                })}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy || isEditingRaw}
          onClick={run(async () => {
            await rpc.call("clearStack", null);
            toast.success("Stack cleared");
            reload();
          })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Icon name="Clean" aria-hidden className="size-3.5" />
          Clear stack
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={isEditingRaw ? () => setIsEditingRaw(false) : openRawEditor}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Icon name="Code" aria-hidden className="size-3.5" />
          {isEditingRaw ? "Close raw JSON" : "Edit raw JSON"}
        </button>
      </div>
      {isEditingRaw ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            Rewrite the stack structure. Entries are coerced leniently: unknown fields are kept, missing ids and timestamps are backfilled, and entries that can’t be salvaged are dropped.
          </p>
          <textarea
            ref={textareaRef}
            value={rawJson}
            onChange={(event) => setRawJson(event.target.value)}
            spellCheck={false}
            rows={Math.min(Math.max(rawJson.split("\n").length + 1, 6), 20)}
            className="mt-2 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Draft Stack JSON"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={applyRaw}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
