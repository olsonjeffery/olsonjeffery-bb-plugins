import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { type SpoolGroupData } from "./useThreadGroups";
import { Fold } from "./Fold";

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
  /** Spool glyph click opens the top (lead) thread. */
  onOpenTop(threadId: string): void;
  /** Ellipsis click opens the spool menu (the list positions it). */
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
  /** Resolves a member thread's display project name (detail facts use it). */
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

/** The shared Fold: same grid-rows collapse + delayed unmount, one module
 *  for the list, the spool roster and the Active deck. */

export function SpoolCardImpl({
  data,
  collapsed,
  onToggle,
  onOpenTop,
  onOpenMenu,
  onContextMenu,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  startRename,
  renderMember,
  hasActiveThread = false,
}: SpoolCardProps) {
  // Rollup counts: derived from the same member statuses the rows show.
  // Working liveness presents in the count pip itself (a success spinner
  // behind the numeral).
  const memberStatuses = data.members.map(memberStatusFor);
  const nWorking = memberStatuses.filter((s) => s === "working").length;

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
      role="group"
      aria-label={`Spool ${data.label}, ${data.members.length} threads`}
      data-spool-id={data.id}
      className={cn(
        "spooler-spool-card",
        collapsed && "spooler-spool-card-collapsed",
        collapsed && hasActiveThread && "spooler-spool-card-active",
      )}
      onContextMenu={onContextMenu}
    >
      {/* The header's own click toggles the fold; interactive children stop
          propagation and keep their own behavior (open-top, ellipsis);
          renaming guards the input. */}
      <div
        className="spooler-spool-header"
        onClick={() => {
          if (!isRenaming) onToggle();
        }}
      >
        {/* The rail carries the spool's glyph — where a drag grip used to
            fade in on hover. Dragging is gone; the mark is just the mark. */}
        <span className="spooler-spool-rail">
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
            <Icon name="Spool" aria-hidden="true" />
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
        </span>
        {/* Trailing cluster: the PERMANENT ellipsis (the spool's only menu
            affordance) left of the "Spool" label, then the count pip — the
            pip is a count again, no longer the actions button. */}
        <span className="spooler-spool-trail">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Spool actions"
            title="Spool actions"
            aria-haspopup="menu"
            className="spooler-spool-more"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenMenu(event);
            }}
          >
            <Icon name="MoreHorizontal" aria-hidden="true" />
          </button>
          <span
            className="spooler-spool-meta"
            title={`Spool · ${nWorking} working`}
          >
            {"Spool"}
            {nWorking > 0 ? ` · ${nWorking} working` : ""}
          </span>
          <span className="spooler-spool-pip">
            <span
              className="spooler-spool-count"
              title={`${data.members.length} thread${data.members.length === 1 ? "" : "s"} in this spool`}
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
            </span>
          </span>
        </span>
      </div>

      <Fold collapsed={collapsed} role="list" label={`${data.label} members`}>
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
