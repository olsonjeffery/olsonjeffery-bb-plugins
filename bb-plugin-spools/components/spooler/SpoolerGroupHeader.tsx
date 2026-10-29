import type { MouseEvent, ReactNode } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Icon } from "@/components/ui/icon";
import { SectionIconGlyph } from "./SectionIcon";
import { cn } from "@/lib/utils";

/** The group shape the header needs; kept structural so callers stay loose. */
export interface GroupHeaderData {
  id: string;
  label: string;
  icon: string;
  total: number;
  unread: number;
  live: number;
  needsUser: number;
  failed: number;
  projectId: string | null;
}

/**
 * One glyph rule for every grouping mode. Previously the sortable and plain
 * paths each hard-coded their own, so the Pinned group rendered a folder in
 * project view while time and section groups rendered no icon at all.
 * Section mode no longer draws this glyph: its rail shows the section's
 * own chosen icon (or nothing) instead.
 */
export function groupGlyph(
  group: Pick<GroupHeaderData, "id" | "icon" | "projectId">,
  isCollapsed: boolean,
): string {
  if (group.id === "pinned") return "Pin";
  if (group.projectId) return isCollapsed ? "Folder" : "FolderOpen";
  return group.icon;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The status chip the count pip overlays in right-title headers. */
function GroupStatus({ group }: { group: GroupHeaderData }) {
  // Attention takes priority over execution, matching the folded-family dot.
  if (group.failed > 0) {
    return (
      <span
        className="spooler-group-status"
        title={plural(group.failed, "failed thread")}
        aria-label={`${group.failed} failed`}
      >
        <span className="spooler-dot spooler-dot-error" />
      </span>
    );
  }
  if (group.needsUser > 0) {
    return (
      <span
        className="spooler-group-status"
        title={plural(group.needsUser, "thread waiting for input")}
        aria-label={`${group.needsUser} waiting for input`}
      >
        <span className="spooler-dot spooler-dot-attention spooler-dot-pulse" />
      </span>
    );
  }
  if (group.live > 0) {
    return (
      <span
        className="spooler-group-status spooler-spinner spooler-tone-running"
        title={plural(group.live, "running thread")}
        aria-label={`${group.live} running`}
      >
        <Icon name="Loading" aria-hidden="true" />
      </span>
    );
  }
  return null;
}

interface HeaderProps {
  group: GroupHeaderData;
  isCollapsed: boolean;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onNewThread?: () => void;
  /** Sections mode: the header reads title-left, controls-right — the rail
   *  carries the section's chosen icon, and the right group runs unread ·
   *  count-plus-working pill · chevron (chevron furthest right). */
  titleRight?: boolean;
  /** Sections mode: the stored icon value for this section (builtin or a
   *  literal pasted glyph); null renders an empty rail. */
  railIcon?: string | null;
  /** Drag-to-reorder affordance; only project grouping supplies these. */
  drag?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  };
}

/** The group header row, shared by the plain and sortable group sections. */
export function GroupHeader({
  group,
  isCollapsed,
  onToggle,
  onContextMenu,
  onNewThread,
  titleRight = false,
  railIcon = null,
  drag,
}: HeaderProps) {
  const counts =
    group.unread > 0
      ? `${group.unread} unread of ${group.total}`
      : plural(group.total, "thread");

  return (
    <div
      className={cn(
        "spooler-group-header",
        drag && "spooler-group-header-sortable",
        titleRight && "spooler-group-header-right",
      )}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="spooler-group-toggle"
        aria-expanded={!isCollapsed}
        aria-label={`${group.label}, ${counts}`}
        title={drag ? `${counts} — drag to reorder` : counts}
        onClick={onToggle}
        {...drag?.attributes}
        {...drag?.listeners}
      >
        {drag ? (
          <span className="spooler-group-grip" aria-hidden="true" title="Drag to reorder">
            <Icon name="DragDropVertical" />
          </span>
        ) : null}
        {titleRight ? (
          // The rail replaces the leading chevron: the collapse chevron lives
          // at the far right, so the icon column can align with the spool
          // cards and thread rows the header opens.
          <span className="spooler-group-rail" aria-hidden="true">
            <SectionIconGlyph raw={railIcon} className="spooler-group-rail-glyph" />
          </span>
        ) : (
          <>
            <Icon
              name={isCollapsed ? "ChevronRight" : "ChevronDown"}
              aria-hidden="true"
              className="spooler-group-chevron"
            />
            <Icon
              name={groupGlyph(group, isCollapsed)}
              aria-hidden="true"
              className="spooler-group-icon"
            />
            <span className="spooler-group-label">{group.label}</span>
          </>
        )}
        {titleRight ? <span className="spooler-group-label">{group.label}</span> : null}
        <span className="spooler-group-meta">
          {titleRight ? null : <GroupStatus group={group} />}
          {group.unread > 0 ? (
            <span className="spooler-group-unread" aria-hidden="true">
              <span className="spooler-unread" />
              {group.unread}
            </span>
          ) : null}
          <span
            className={cn(
              "spooler-group-count",
              titleRight && "spooler-group-count-pip",
            )}
          >
            {titleRight ? <GroupStatus group={group} /> : null}
            <span className="spooler-pip-numeral">{group.total}</span>
          </span>
          {titleRight ? (
            <Icon
              name={isCollapsed ? "ChevronRight" : "ChevronDown"}
              aria-hidden="true"
              className="spooler-group-chevron spooler-group-chevron-right"
            />
          ) : null}
        </span>
      </button>
      {onNewThread ? (
        <button
          type="button"
          className="spooler-group-new-thread"
          aria-label={`Start new thread in ${group.label}`}
          title={`Start new thread in ${group.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onNewThread();
          }}
        >
          <Icon name="MessageSquarePlus" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** A drag-reorderable group section (project grouping). */
export function SortableGroupSection({
  group,
  isCollapsed,
  onToggle,
  onNewThread,
  onContextMenu,
  children,
}: {
  group: GroupHeaderData;
  isCollapsed: boolean;
  onToggle: () => void;
  onNewThread?: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  return (
    <section
      ref={setNodeRef}
      aria-label={group.label}
      className={cn(
        "spooler-group",
        group.projectId && "spooler-group-project",
        isCollapsed ? "spooler-group-collapsed" : "spooler-group-expanded",
        isDragging && "spooler-group-dragging",
      )}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : undefined,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <GroupHeader
        group={group}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onContextMenu={onContextMenu}
        onNewThread={onNewThread}
        drag={{ attributes, listeners }}
      />
      {children}
    </section>
  );
}
