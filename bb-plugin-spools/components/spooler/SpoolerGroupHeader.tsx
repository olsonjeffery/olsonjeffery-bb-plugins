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
 * Section mode draws its own chosen icon in the rail; the other modes use
 * this glyph (Inbox itself gets the host's Inbox glyph).
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

interface HeaderProps {
  group: GroupHeaderData;
  isCollapsed: boolean;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onNewThread?: () => void;
  /** Sections mode: the header reads title-left like every other mode — the
   *  rail carries the section's chosen icon; the label may clamp to two
   *  rows (the mode's longer titles). */
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

/** The group header row, shared by the plain and sortable group sections.
 *  Anatomy (the mock's one-line caption): chevron, marker icon, label and
 *  total on the left; pills only for the states that need action on the
 *  right. No colour dots anywhere. Pills: "N failed" (destructive surface),
 *  "N needs you" (attention surface, ink text, amber dot), and a plain
 *  success text count with a spinner for running work. */
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
        <Icon
          name={isCollapsed ? "ChevronRight" : "ChevronDown"}
          aria-hidden="true"
          className="spooler-group-chevron"
        />
        <span className="spooler-group-rail" aria-hidden="true">
          {titleRight && railIcon ? (
            <SectionIconGlyph raw={railIcon} className="spooler-group-rail-glyph" />
          ) : titleRight ? (
            // Sections with no stored icon show nothing except the fixed
            // Inbox bucket, whose group carries the host's Inbox glyph.
            group.icon === "Inbox" ? (
              <Icon name="Inbox" className="spooler-group-rail-glyph" />
            ) : null
          ) : (
            <Icon name={groupGlyph(group, isCollapsed)} className="spooler-group-rail-glyph" />
          )}
        </span>
        <span className="spooler-group-label">{group.label}</span>
        <span className="spooler-group-total">{group.total}</span>
      </button>
      <span className="spooler-group-pills">
        {group.failed > 0 ? (
          <span
            className="spooler-group-pill spooler-group-pill-failed"
            title={plural(group.failed, "failed thread")}
          >
            <span className="spooler-dot spooler-dot-error" aria-hidden="true" />
            {group.failed} failed
          </span>
        ) : null}
        {group.needsUser > 0 ? (
          <span
            className="spooler-group-pill spooler-group-pill-needs"
            title={plural(group.needsUser, "thread waiting for input")}
          >
            <span
              className="spooler-dot spooler-dot-attention"
              aria-hidden="true"
            />
            {group.needsUser} needs you
          </span>
        ) : null}
        {group.live > 0 ? (
          <span
            className="spooler-group-pill spooler-group-pill-working"
            title={plural(group.live, "running thread")}
          >
            <span className="spooler-spinner spooler-tone-success spooler-group-pill-spinner">
              <Icon name="Loading" aria-hidden="true" />
            </span>
            {group.live} working
          </span>
        ) : null}
      </span>
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
