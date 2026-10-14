import type { MouseEvent, ReactNode } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Icon } from "@/components/ui/icon";
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
        <span className="spooler-group-meta">
          <GroupStatus group={group} />
          {group.unread > 0 ? (
            <span className="spooler-group-unread" aria-hidden="true">
              <span className="spooler-unread" />
              {group.unread}
            </span>
          ) : null}
          <span className="spooler-group-count">{group.total}</span>
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
