import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { type SpoolGroupData } from "./useThreadGroups";

/** Outlasts the `.spooler-fold` collapse transition (280ms in app.css). */
const FOLD_UNMOUNT_MS = 320;

/** How long the peek panel lingers after the pointer leaves the card. */
const PEEK_LINGER_MS = 500;

/**
 * Status for a peek pip, derived exactly like the ordinary row's visual:
 * the host-resolved indicator first, then plain unread as need.
 */
export interface SpoolCardProps {
  data: SpoolGroupData;
  /** Single-click toggles via onToggle. */
  collapsed: boolean;
  onToggle(): void;
  /** Open a member thread. */
  onOpen(threadId: string): void;
  /** Layers-icon click opens the top (lead) thread. */
  onOpenTop(threadId: string): void;
  /** Archive Spool Threads (confirm handled by parent). */
  onArchive(): void;
  /** Destructive unspool (confirm handled by parent). */
  onUnspool(): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  /** In-place rename of the spool title (double-click the title). */
  isRenaming: boolean;
  onRenameCommit(title: string): void;
  onRenameCancel(): void;
  startRename(): void;
  /** Member parity: the parent renders each member row through the ordinary
   *  row renderer; we only provide wrappers and ordering. */
  renderMember(
    thread: PluginSidebarThread,
    index: number,
    isLast: boolean,
  ): ReactNode;
  /** Current dragged thread id, for drop-affordance checks. */
  draggingThreadId: string | null;
}

type PeekStatus =
  | "idle"
  | "need"
  | "question"
  | "failed"
  | "success"
  | "working";

function peekStatusFor(thread: PluginSidebarThread): PeekStatus {
  switch (thread.indicator) {
    case "waiting-for-input":
      return "need";
    case "queued-waiting":
      return "question";
    case "unread-error":
    case "queued-failed":
      return "failed";
    case "unread-success":
      return "success";
    case "runtime":
    case "background-agent":
    case "background-command":
    case "workflow":
    case "goal":
    case "plan-mode":
    case "working-draft":
      return "working";
    default:
      break;
  }
  return thread.isUnread ? "need" : "idle";
}

/** Quiet states breathe; answered/idle breathe too (idle breathes white). */
function breatheFor(status: PeekStatus): boolean {
  return (
    status === "idle" || status === "need" || status === "failed"
  );
}

/**
 * Local copy of the list's Fold (same grid-rows collapse + delayed unmount).
 * Kept here so the spool card doesn't import from SpoolerThreadList.
 */
function Fold({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: () => ReactNode;
}) {
  const [closed, setClosed] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setClosed(false);
      return;
    }
    const timer = setTimeout(() => setClosed(true), FOLD_UNMOUNT_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return (
    <div
      className={cn("spooler-fold", collapsed && "spooler-fold-collapsed")}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="spooler-fold-inner" role="list" aria-label={label}>
        {collapsed && closed ? null : children()}
      </div>
    </div>
  );
}

export function SpoolCardImpl({
  data,
  collapsed,
  onToggle,
  onOpen,
  onOpenTop,
  onArchive,
  onUnspool,
  onContextMenu,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  startRename,
  renderMember,
  draggingThreadId,
}: SpoolCardProps) {
  // ONE draggable (grip only) and ONE droppable, both on this card.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `spool:${data.id}`,
    data: {
      spoolId: data.id,
      memberIds: data.members.map((member) => member.id),
    },
  });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: `spoolcard:${data.id}`,
    data: { kind: "spool", spoolId: data.id },
  });
  const dropActive = draggingThreadId !== null && isOver;

  // In-place rename. Seeds once per rename start, like the ordinary row.
  const [renameValue, setRenameValue] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef(data.customTitle ?? data.label);
  titleRef.current = data.customTitle ?? data.label;
  useEffect(() => {
    if (!isRenaming) return;
    setCancelled(false);
    setRenameValue(titleRef.current);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isRenaming]);

  // Member peek: opens immediately on card hover, lingers 500ms after the
  // pointer leaves (the panel is a child of the card, so hovering it keeps
  // the card hovered and clicks keep working through the linger).
  const [peekOpen, setPeekOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const openPeek = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPeekOpen(true);
  }, []);
  const schedulePeekClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPeekOpen(false);
    }, PEEK_LINGER_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, []);

  const commit = () => {
    if (cancelled) return;
    onRenameCommit(renameValue);
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropNodeRef(node);
      }}
      role="group"
      aria-label={`Spool ${data.label}, ${data.members.length} threads`}
      data-spool-id={data.id}
      className={cn(
        "spooler-spool-card",
        collapsed && "spooler-spool-card-collapsed",
        isDragging && "spooler-spool-card-dragging",
        dropActive && "spooler-spool-drop-active",
      )}
      onContextMenu={onContextMenu}
      onMouseEnter={openPeek}
      onMouseLeave={schedulePeekClose}
    >
      {/* Stacked-deck layers peeking out below the card. */}
      <div className="spooler-spool-stack-layer spooler-spool-stack-layer-1" aria-hidden="true" />
      <div className="spooler-spool-stack-layer spooler-spool-stack-layer-2" aria-hidden="true" />

      <div className="spooler-spool-header">
        {/* Grip only: a plain click never starts a drag. */}
        <button
          type="button"
          className="spooler-row-grip"
          aria-label="Drag spool onto a section header to file its threads"
          title="Drag spool onto a section header to file its threads"
          onClick={(event) => event.preventDefault()}
          {...attributes}
          {...listeners}
        >
          <Icon name="DragDropVertical" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="spooler-spool-icon"
          title="Open top thread"
          aria-label="Open top thread"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTop(data.leadThreadId);
          }}
        >
          <Icon name="Layers" aria-hidden="true" />
        </button>
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setCancelled(true);
                onRenameCancel();
              }
            }}
            onBlur={commit}
            aria-label="Rename spool"
            placeholder={data.customTitle ?? data.label}
            maxLength={200}
            className="spooler-rename spooler-spool-rename"
          />
        ) : (
          <button
            type="button"
            className="spooler-spool-title-btn"
            title={
              data.customTitle
                ? data.label
                : `${data.label} (double-click to rename)`
            }
            onClick={() => onToggle()}
            onDoubleClick={(event) => {
              event.preventDefault();
              startRename();
            }}
          >
            <span className="spooler-spool-title">{data.label}</span>
          </button>
        )}
        <div className="spooler-spool-actions">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Archive spool threads"
            title="Archive spool threads"
            className="spooler-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onArchive();
            }}
          >
            <Icon name="Archive" aria-hidden="true" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Unspool (release threads back to the list)"
            title="Unspool (release threads back to the list)"
            className="spooler-action spooler-spool-unspool"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnspool();
            }}
          >
            <Icon name="X" aria-hidden="true" />
          </button>
        </div>
        <span
          className="spooler-spool-count"
          title={`${data.members.length} thread${data.members.length === 1 ? "" : "s"} in this spool`}
        >
          {data.members.length}
        </span>
      </div>

      <Fold collapsed={collapsed} label={`${data.label} members`}>
        {() => (
          <div className="spooler-spool-members">
            {data.members.map((member, index) => (
              <div
                key={member.id}
                className="spooler-spool-member"
                data-member-id={member.id}
              >
                {renderMember(member, index, index === data.members.length - 1)}
              </div>
            ))}
          </div>
        )}
      </Fold>

      {peekOpen ? (
        <div className="spooler-spool-peek" role="tooltip">
          <div className="spooler-spool-peek-title" title={data.label}>
            {data.label}
          </div>
          <div className="spooler-spool-peek-rule" aria-hidden="true" />
          <div className="spooler-spool-peek-list">
            {data.members.map((member) => {
              const status = peekStatusFor(member);
              const breathe = breatheFor(status);
              return (
                <button
                  key={member.id}
                  type="button"
                  className="spooler-spool-peek-row"
                  title={member.displayTitle}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(member.id);
                  }}
                >
                  <span
                    className={cn(
                      "spooler-peek-dot",
                      `spooler-peek-dot-${status}`,
                      breathe && "spooler-peek-dot-breathe",
                    )}
                    data-breathe={breathe ? "" : undefined}
                    data-status={status}
                    role="img"
                    aria-label={status}
                  />
                  <span className="spooler-spool-peek-entry">
                    {member.displayTitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const SpoolCard = SpoolCardImpl;
