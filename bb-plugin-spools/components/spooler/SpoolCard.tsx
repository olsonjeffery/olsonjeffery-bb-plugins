import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
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
import { type SpoolGroupData } from "./useThreadGroups";
import { useEnvironmentPullRequest } from "./usePullRequest";

/** Outlasts the `.spooler-fold` collapse transition (280ms in app.css). */
const FOLD_UNMOUNT_MS = 320;

/**
 * Status for the member rollup counts, derived exactly like the ordinary
 * row's visual: the host-resolved indicator first, then plain unread as need.
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
  /** The thread being viewed is a member of this spool: while the card is
   *  collapsed its members render no rows, so no active row tint could show;
   *  the panel itself carries the active (accent) tint instead. */
  hasActiveThread?: boolean;
}

type MemberStatus =
  | "idle"
  | "need"
  | "question"
  | "failed"
  | "success"
  | "working";

function memberStatusFor(thread: PluginSidebarThread): MemberStatus {
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
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  startRename,
  renderMember,
  draggingThreadId,
  projectNameFor,
  hasActiveThread = false,
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
  const leadEnvironmentId = data.members[0]?.environment?.id ?? null;
  const pullRequest = useEnvironmentPullRequest(leadEnvironmentId);
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
  // Liveness rollup (item 6): the card hides its member rows, so the common
  // context must be summarized on the header.

  // Rollup counts: derived from the same member statuses the rows show.
  const memberStatuses = data.members.map(memberStatusFor);
  const nWorking = memberStatuses.filter((s) => s === "working").length;
  const nQuestion = memberStatuses.filter((s) => s === "question").length;
  const nUnread = memberStatuses.filter((s) => s === "need").length;
  const nFailed = memberStatuses.filter((s) => s === "failed").length;
  // Working liveness presents in the count pip itself (a green spinner
  // behind the numeral), the same pip grammar the section headers use —
  // there is no separate text badge, and the rollup never repeats it.
  // Non-working parts stay in both states.
  const rollupRest = [
    nQuestion > 0 ? `${nQuestion} needs you` : null,
    nUnread > 0 ? `${nUnread} unread` : null,
    nFailed > 0 ? `${nFailed} failed` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ") || null;
  // The rollup's tooltip: the full member-status line, same words the
  // collapsed roster could not carry live.
  const rollupMeta = [
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
        collapsed && hasActiveThread && "spooler-spool-card-active",
        isDragging && "spooler-spool-card-dragging",
        dropActive && "spooler-spool-drop-active",
      )}
      onContextMenu={onContextMenu}
    >

      {/* The header's own click toggles the fold; interactive children stop
          propagation and keep their own behavior (drag, open-top, PR link,
          actions pip); renaming guards the input. */}
      <div
        className="spooler-spool-header"
        onClick={() => {
          if (!isRenaming) onToggle();
        }}
      >
        {/* The rail stacks the 🧵 mark over the drag grip: the grip fades in
            on hover WITHOUT moving the mark, so the spool's icon axis stays
            static (aligned with section icons and thread provider icons). */}
        <span className="spooler-spool-rail">
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
        </span>
        <span className="spooler-spool-entry">
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
        {/* Detail pills run in ONE wrapping grid under the title — a pill
            ellipsizes inside its own box and the grid re-flows to further
            lines; the title's two-line clamp always outranks them. The rollup
            rides the grid like any other pill. */}
        <div className="spooler-spool-grid spooler-row-grid">
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
            {rollupRest ? (
              <span className="spooler-spool-rollup" title={rollupMeta}>
                {rollupRest}
              </span>
            ) : null}
        </div>
        </span>
        {/* The count pip IS the actions button (the ellipsis never worked
            reliably): clicking it opens the spool context menu. */}
        <span className="spooler-spool-pip">
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
            {nWorking > 0 ? (
              <span
                className="spooler-spool-pip-status spooler-spinner spooler-tone-success"
                title={`${nWorking} working`}
                aria-label={`${nWorking} working`}
              >
                <Icon name="Loading" aria-hidden="true" />
              </span>
            ) : null}
            <span className="spooler-pip-numeral">{data.members.length}</span>
          </button>
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

    </div>
  );
}

export const SpoolCard = SpoolCardImpl;