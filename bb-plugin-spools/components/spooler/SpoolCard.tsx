import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  experimental_useSidebarThreadPullRequest,
  useBbNavigate,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  prBadgeClass,
  prIconName,
  prLabel,
  prToneClass,
  projectHue,
} from "./SpoolerThreadRow";
import { isLiveThread } from "./time";
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
  /** 🧵 icon click opens the top (lead) thread. */
  onOpenTop(threadId: string): void;
  /** Ellipsis click opens the spool menu (parent positions it). */
  onOpenMenu(event: React.MouseEvent<HTMLButtonElement>): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  /** True while the spool's context/pip menu is raised: the peek is
   *  dismissed and re-opening it is suppressed for the menu's lifetime. */
  menuOpen?: boolean;
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
  /** Resolves a member thread's display project name (badge chips). */
  projectNameFor(thread: PluginSidebarThread): string;
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
  onOpenMenu,
  onContextMenu,
  menuOpen = false,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  startRename,
  renderMember,
  draggingThreadId,
  projectNameFor,
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

  // Collapsed-card badges (item 6): the card hides its member rows, so the
  // common context must be summarized on the header. Lead thread only —
  // members share a branch, so one PR stands for the spool.
  const navigate = useBbNavigate();
  const { pullRequest } = experimental_useSidebarThreadPullRequest(
    data.leadThreadId,
  );
  const lead = data.members[0] ?? null;
  const projectIds = new Set(
    data.members.map((member) => member.projectId),
  );
  const uniformProjectName = projectIds.size === 1 && lead
    ? projectNameFor(lead)
    : null;
  const branchSet = new Set(
    data.members.map((member) => member.environment?.branchName ?? null),
  );
  const uniformBranch =
    branchSet.size === 1 && lead?.environment?.branchName
      ? lead.environment.branchName
      : null;
  // The count pip breathes while any member runs (user: gray halo, always).
  const anyWorking = data.members.some((member) => isLiveThread(member));

  // Peek meta line (hover-card parity): thread count plus any live states.
  const peekStatuses = data.members.map(peekStatusFor);
  const nWorking = peekStatuses.filter((s) => s === "working").length;
  const nQuestion = peekStatuses.filter((s) => s === "question").length;
  const nUnread = peekStatuses.filter((s) => s === "need").length;
  const nFailed = peekStatuses.filter((s) => s === "failed").length;
  const rollupLabel = [
    nWorking > 0 ? `${nWorking} working` : null,
    nQuestion > 0 ? `${nQuestion} needs you` : null,
    nUnread > 0 ? `${nUnread} unread` : null,
    nFailed > 0 ? `${nFailed} failed` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ") || null;
  const peekMeta = [
    `${data.members.length} thread${data.members.length === 1 ? "" : "s"}`,
    nWorking > 0 ? `${nWorking} working` : null,
    nQuestion > 0 ? `${nQuestion} needs you` : null,
    nUnread > 0 ? `${nUnread} unread` : null,
    nFailed > 0 ? `${nFailed} failed` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

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
  // pointer leaves. The panel is portaled to document.body (so sidebar
  // scroll containers can't clip it), so its own mouse handlers keep the
  // linger alive while the pointer travels into the panel.
  const [peekOpen, setPeekOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openPeek = useCallback(() => {
    // The context/pip menu owns the screen when it is up: no peek under it.
    if (menuOpenRef.current) return;
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

  const closePeekNow = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPeekOpen(false);
  }, []);

  // Keep the openPeek suppression in a ref so the callback list stays empty
  // (the handlers hang off the header's synthetic events) while menuOpen
  // state changes drive dismissal from its own effect below.
  const menuOpenRef = useRef(menuOpen);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    if (menuOpen) closePeekNow();
  }, [menuOpen, closePeekNow]);

  // Position the portaled peek panel next to the card, clamped to the
  // viewport. Runs before paint; offsetWidth/Height ignore transforms so
  // the entrance animation can't skew the measurement.
  useLayoutEffect(() => {
    if (!peekOpen) return;
    const el = peekRef.current;
    const card = cardRef.current;
    if (!el || !card) return;
    const margin = 8;
    const gap = 8;
    const cardRect = card.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = cardRect.right + gap;
    let side = "right";
    if (left + width > vw - margin) {
      left = cardRect.left - gap - width;
      side = "left";
    }
    if (left < margin) left = margin;
    if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);
    let top = cardRect.top;
    if (top + height > vh - margin) top = vh - margin - height;
    if (top < margin) top = margin;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.dataset.side = side;
    // Keep the arrow pointing at the header row even after the nudge.
    const header = headerRef.current;
    if (header) {
      const headerRect = header.getBoundingClientRect();
      const rowMid = (headerRect.top + headerRect.bottom) / 2;
      const arrow = Math.min(
        Math.max(rowMid - top, 14),
        Math.max(height - 14, 14),
      );
      el.style.setProperty("--spooler-arrow-y", `${Math.round(arrow)}px`);
    }
  }, [peekOpen]);

  const commit = () => {
    if (cancelled) return;
    onRenameCommit(renameValue);
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropNodeRef(node);
        cardRef.current = node;
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
    >
      {/* Stacked-deck layers peeking out below the card. */}
      <div className="spooler-spool-stack-layer spooler-spool-stack-layer-1" aria-hidden="true" />
      <div className="spooler-spool-stack-layer spooler-spool-stack-layer-2" aria-hidden="true" />

      {/* Peek triggers ONLY on the header: hovering a member row is the
          row's own thread hover card, not the spool's. The header's own
          click toggles too, so the badges line and empty header background
          collapse/expand like the title does. Interactive children stop
          propagation and keep their own behavior (drag, open-top, PR link,
          actions pip); renaming guards the input. */}
      <div
        ref={headerRef}
        className="spooler-spool-header"
        onMouseEnter={openPeek}
        onMouseLeave={schedulePeekClose}
        onClick={() => {
          if (!isRenaming) onToggle();
        }}
      >
        {/* Grip only: a plain click never starts a drag. */}
        <button
          type="button"
          className="spooler-row-grip"
          aria-label="Drag spool onto a section header to file its threads"
          title="Drag spool onto a section header to file its threads"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
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
          <span aria-hidden="true" className="spooler-spool-emoji">🧵</span>
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
            onClick={(event) => {
              // The header background toggles too; don't let the title's
              // toggle bubble up and fire twice.
              event.stopPropagation();
              onToggle();
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              startRename();
            }}
          >
            <span className="spooler-spool-title">{data.label}</span>
          </button>
        )}
        {/* Badges stay visible in both states: collapsing a spool hides its
            thread list, not what the threads have in common. The rollup sits
            on the right and fills the empty side of the badge line with the
            liveness states the expanded body no longer shows. */}
        <div className="spooler-spool-badges">
          {uniformProjectName ? (
              <span
                className="spooler-row-project"
                title={`All threads in project: ${uniformProjectName}`}
                style={{
                  "--spooler-project-hue": projectHue(lead!.projectId),
                } as CSSProperties}
              >
                {uniformProjectName}
              </span>
            ) : projectIds.size > 1 ? (
              <span
                className="spooler-spool-badge-muted"
                title={`Threads span ${projectIds.size} projects`}
              >
                {projectIds.size} projects
              </span>
            ) : null}
            {uniformBranch ? (
              <span
                className="spooler-spool-badge-branch"
                title={`All threads on branch: ${uniformBranch}`}
              >
                <Icon name="GitBranch" aria-hidden="true" />
                <span className="spooler-branch-text">{uniformBranch}</span>
              </span>
            ) : null}
            {uniformBranch && pullRequest ? (
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  "spooler-pr-link",
                  prBadgeClass(pullRequest.state, pullRequest.attention),
                  prToneClass(pullRequest.attention),
                )}
                title={`${pullRequest.title} — open PR #${pullRequest.number} (${prLabel(pullRequest.state, pullRequest.attention)})`}
                aria-label={`Open pull request ${pullRequest.number}: ${pullRequest.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  navigate.openUrl(pullRequest.url);
                }}
              >
                <Icon
                  name={prIconName(pullRequest.state, pullRequest.attention)}
                  aria-hidden="true"
                />
                <span>
                  #{pullRequest.number} ·{" "}
                  {prLabel(pullRequest.state, pullRequest.attention)}
                </span>
              </button>
            ) : null}
            {rollupLabel ? (
              <span className="spooler-spool-rollup" title={peekMeta}>
                {rollupLabel}
              </span>
            ) : null}
          </div>
        {/* The count pip IS the actions button (the ellipsis never worked
            reliably): clicking it opens the spool context menu. */}
        <span
          className={cn(
            "spooler-spool-pip",
            anyWorking && "spooler-spool-pip-working",
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Spool actions"
            title={`${data.members.length} thread${data.members.length === 1 ? "" : "s"} in this spool — actions`}
            aria-haspopup="menu"
            className="spooler-spool-count"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenMenu(event);
            }}
          >
            {data.members.length}
          </button>
        </span>
      </div>

      <Fold collapsed={collapsed} label={`${data.label} members`}>
        {() => (
          <div className="spooler-spool-members" onMouseEnter={closePeekNow}>
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

      {peekOpen
        ? createPortal(
            <div
          ref={peekRef}
          className="spooler-spool-peek"
          role="tooltip"
          style={{ position: "fixed" }}
          onMouseEnter={openPeek}
          onMouseLeave={schedulePeekClose}
        >
          <div className="spooler-spool-peek-head">
            <div className="spooler-spool-peek-head-row">
              <span
                aria-hidden="true"
                className="spooler-spool-peek-emoji"
              >
                🧵
              </span>
              <span className="spooler-spool-peek-title" title={data.label}>
                {data.label}
              </span>
            </div>
            <div className="spooler-spool-peek-meta">{peekMeta}</div>
          </div>
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
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}

export const SpoolCard = SpoolCardImpl;
