import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ThreadTitle,
  experimental_Icon as HostIcon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  useBbNavigate,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginBrowserBbSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { type SpoolerThreadActions } from "./useThreadRowActions";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isLiveThread } from "./time";
import {
  formatReasoningLevel,
  useModelDisplayName,
  useThreadExecution,
} from "./useThreadExecution";
import { SpoolerHoverCard, type ContextUsage } from "./SpoolerHoverCard";
import { useRowSwipe } from "./useRowSwipe";
import {
  swipeActionView,
  type SwipeActionId,
  type SwipeActionView,
} from "@/lib/swipe";

/** Family folding for threads with shown children (null for leaves). */
export interface RowCollapse {
  collapsed: boolean;
  hiddenTotal: number;
  hiddenUnread: number;
  hiddenLive: boolean;
  hiddenNeedsUser: boolean;
  hiddenFailed: boolean;
  hiddenKids: { id: string; title: string; dot: string | null }[];
  onToggle: () => void;
}

/** Loudest hidden state first: failed, needs-you, then live. */
function hiddenRollupDotClass(collapse: RowCollapse): string | null {
  if (collapse.hiddenFailed) return "spooler-dot-error";
  if (collapse.hiddenNeedsUser) return "spooler-dot-attention";
  if (collapse.hiddenLive) return "spooler-dot-running spooler-dot-pulse";
  return null;
}

function foldedKidsText(collapse: RowCollapse): string {
  const names = collapse.hiddenKids.map((kid) => kid.title).join(", ");
  const overflow = collapse.hiddenTotal - collapse.hiddenKids.length;
  return `Hidden replies: ${names}${overflow > 0 ? `, +${overflow} more` : ""}`;
}

function hiddenSummary(collapse: RowCollapse): string {
  const parts = [
    `${collapse.hiddenTotal} hidden`,
    collapse.hiddenUnread > 0 ? `${collapse.hiddenUnread} unread` : null,
  ].filter((part): part is string => !!part);
  return parts.join(", ");
}

/** Minimal provider record for the agent icon (extra fields ignored). */
export interface RowProviderIcon {
  id: string;
  logoUrl?: string | null;
  icon?: { glyph: string } | string | null;
}

/**
 * Map the host-resolved indicator to a status visual. Unknown → none.
 * Working (runtime) is a spinner; background activity pulses; finished but
 * unseen is a small static muted dot — never the same as working.
 */
type StatusVisual =
  | { kind: "spinner" }
  | { kind: "dot"; className: string }
  | { kind: "icon"; name: string; className: string }
  | null;

function statusVisualFor(indicator: string): StatusVisual {
  switch (indicator) {
    case "runtime":
      return { kind: "spinner" };
    case "background-agent":
      return {
        kind: "icon",
        name: "Bot",
        className: "spooler-tone-success spooler-icon-pulse",
      };
    case "background-command":
      return {
        kind: "icon",
        name: "Terminal",
        className: "spooler-tone-success spooler-icon-pulse",
      };
    case "workflow":
      return {
        kind: "icon",
        name: "Workflow",
        className: "spooler-tone-success spooler-icon-pulse",
      };
    case "goal":
      return {
        kind: "icon",
        name: "Target",
        className: "spooler-tone-success spooler-icon-pulse",
      };
    case "plan-mode":
      return {
        kind: "icon",
        name: "ListTodo",
        className: "spooler-tone-success spooler-icon-pulse",
      };
    case "working-draft":
      return { kind: "dot", className: "spooler-dot-running spooler-dot-pulse" };
    case "waiting-for-input":
    case "queued-waiting":
      return { kind: "dot", className: "spooler-dot-attention" };
    case "unread-error":
    case "queued-failed":
      return { kind: "icon", name: "CircleX", className: "spooler-tone-error" };
    case "unread-success":
      return { kind: "icon", name: "CircleCheck", className: "spooler-tone-success" };
    case "draft":
    case "none":
    default:
      return null;
  }
}

/** Human label for a pull request: attention first, then bare state. */
export function prLabel(state: string, attention: string): string {
  switch (attention) {
    case "ready_to_merge":
      return "Ready to merge";
    case "changes_requested":
      return "Changes requested";
    case "checks_failed":
      return "Checks failed";
    case "checks_pending":
      return "Checks pending";
    case "conflicts":
      return "Conflicts";
    case "blocked":
      return "Blocked";
    case "review_requested":
      return "Review requested";
    case "merged":
      return "Merged";
    case "draft":
      return "Draft";
    case "closed":
      return "Closed";
    case "none":
    default:
      break;
  }
  switch (state) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return state;
  }
}

/** Visual tone for a pull request's attention, shared with the spool card. */
export function prToneClass(attention: string): string {
  switch (attention) {
    case "checks_failed":
    case "conflicts":
      return "spooler-tone-error";
    case "changes_requested":
    case "blocked":
      return "spooler-tone-warning";
    case "review_requested":
    case "checks_pending":
      return "spooler-tone-info";
    case "ready_to_merge":
    case "merged":
      return "spooler-tone-success";
    default:
      return "spooler-tone-muted";
  }
}

/** Pill class for a pull request state, shared with the spool card. */
export function prBadgeClass(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "spooler-pr-merged";
  if (state === "closed" || attention === "closed") return "spooler-pr-closed";
  if (state === "draft" || attention === "draft") return "spooler-pr-draft";
  return "spooler-pr-open";
}

/** Icon for a pull request state, shared with the spool card. */
export function prIconName(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "GitMerge";
  if (state === "closed" || attention === "closed") return "GitPullRequestClosed";
  if (state === "draft" || attention === "draft") return "GitPullRequestDraft";
  return "GitPullRequest";
}

/** Tiny explicit word for the status slot. Unknown indicators get none. */
function statusWordFor(
  indicator: string,
): { text: string; tone: string } | null {
  switch (indicator) {
    case "runtime":
    case "working-draft":
      return { text: "Working", tone: "spooler-tone-success" };
    case "background-agent":
      return { text: "Agent", tone: "spooler-tone-success" };
    case "background-command":
      return { text: "Command", tone: "spooler-tone-success" };
    case "workflow":
      return { text: "Workflow", tone: "spooler-tone-success" };
    case "goal":
      return { text: "Goal", tone: "spooler-tone-success" };
    case "plan-mode":
      return { text: "Plan", tone: "spooler-tone-success" };
    case "waiting-for-input":
      return { text: "Needs you", tone: "spooler-tone-warning" };
    case "queued-waiting":
      return { text: "Queued", tone: "spooler-tone-warning" };
    case "unread-error":
    case "queued-failed":
      return { text: "Failed", tone: "spooler-tone-error" };
    case "unread-success":
      return { text: "Done", tone: "spooler-tone-success" };
    default:
      return null;
  }
}

/** Stable hue per project id, so chips keep identity across renames. */
export function projectHue(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

let hoverCapable: boolean | null = null;

/** Hover previews need a real hover-capable pointer (never touch). */
function canHoverPreview(): boolean {
  if (hoverCapable === null) {
    hoverCapable =
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches;
  }
  return hoverCapable;
}

function rowStatusToneClass(tone: string | undefined): string {
  switch (tone) {
    case "running":
      return "spooler-tone-running";
    case "success":
      return "spooler-tone-success";
    case "error":
      return "spooler-tone-error";
    default:
      return "spooler-tone-muted";
  }
}

function SpoolerThreadRowImpl({
  thread,
  depth,
  isLastChild,
  projectName,
  sectionName,
  sectionId,
  celebrate,
  allowHoverCard = true,
  adaptiveCollapse = true,
  isActive,
  isEditing,
  isVisible = true,
  actions,
  timeText,
  onNavigate,
  onOpenMenu,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onUnarchive,
  providerName,
  providerIcon,
  projectTag,
  projectColorHue,
  collapse,
  primaryHostId,
  sdk,
  modelEpoch,
  density = "comfortable",
  isSelected = false,
  selectionActive = false,
  selectedIds,
  isKeyboardFocused = false,
  onToggleSelect,
  dragHandle,
  swipeRight = "none",
  swipeLeft = "none",
  listFiltersArchived = true,
  hasChildren = false,
  isShortcutTarget,
}: {
  thread: PluginSidebarThread;
  depth: number;
  isLastChild: boolean;
  projectName: string;
  sectionName: string | null;
  sectionId: string | null;
  celebrate: boolean;
  /** Plugin settings: gate the peek card and the quiet-row fold. */
  allowHoverCard?: boolean;
  adaptiveCollapse?: boolean;
  isActive: boolean;
  isEditing: boolean;
  /** False inside a folded group or ancestor; suspend requests and gestures. */
  isVisible?: boolean;
  actions: SpoolerThreadActions;
  /** Relative activity time, e.g. "5m ago". A string rather than the clock,
   * so the minute tick re-renders only rows whose label actually moved. */
  timeText: string;
  onNavigate: () => void;
  onOpenMenu: (clientX: number, clientY: number, thread: PluginSidebarThread) => void;
  onStartRename: (thread: PluginSidebarThread) => void;
  onCommitRename: (thread: PluginSidebarThread, title: string) => void;
  onCancelRename: () => void;
  onUnarchive: (thread: PluginSidebarThread) => void;
  providerName: string;
  providerIcon: RowProviderIcon | null;
  /** Project chip text, or null when redundant with the group header. */
  projectTag: string | null;
  /** Optional custom hue for the project chip (overrides default stable hash). */
  projectColorHue?: number | null;
  collapse: RowCollapse | null;
  primaryHostId: string | null;
  sdk: PluginBrowserBbSdk;
  modelEpoch: number;
  density?: "comfortable" | "compact";
  isSelected?: boolean;
  selectionActive?: boolean;
  selectedIds?: Set<string>;
  isKeyboardFocused?: boolean;
  onToggleSelect?: (event: React.MouseEvent, threadId: string) => void;
  /** Grip affordance for drag-to-section (section grouping only). */
  dragHandle?: import("./SpoolerThreadList").RowDragHandle | null;
  /** Touch swipe actions per direction; "none" leaves that side inert. */
  swipeRight?: SwipeActionId;
  swipeLeft?: SwipeActionId;
  /** False on the All tab, where archiving leaves the row in place. */
  listFiltersArchived?: boolean;
  /** Whether the thread has any replies, shown or filtered out: archiving it
   *  then asks the host to confirm. */
  hasChildren?: boolean;
  /**
   * False while a folded family or group hides the row. bb numbers jump
   * shortcuts over every marked row in DOM order, and a closing fold keeps
   * its rows mounted until its animation ends.
   */
  isShortcutTarget: boolean;
}) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const navigate = useBbNavigate();
  const { splitProps, layout: splitLayout } =
    experimental_useSidebarThreadSplit(thread.id);

  const [renameValue, setRenameValue] = useState("");
  const [copiedBranch, setCopiedBranch] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoverCardTimer = useRef<number | null>(null);
  const isHoveringCard = useRef(false);
  const [hoverCard, setHoverCard] = useState<{
    anchor: { top: number; bottom: number; left: number; right: number };
  } | null>(null);

  const fetchThreadContext = useCallback(
    async (targetThreadId: string): Promise<ContextUsage | null> => {
      try {
        const res = await sdk.threads.context({ threadId: targetThreadId });
        const usage = res?.usage;
        if (!usage) return null;
        return {
          usedTokens: usage.usedTokens,
          modelContextWindow: usage.modelContextWindow,
          estimated: usage.estimated,
          autoCompactAtTokens: usage.snapshot?.autoCompactAtTokens ?? null,
          categories:
            usage.snapshot?.categories.map((category) => ({
              id: category.id,
              label: category.label,
              kind: category.kind,
              tokens: category.tokens,
              entries: category.entries.map((entry) => ({
                id: entry.id,
                label: entry.label,
                tokens: entry.tokens,
              })),
            })) ?? [],
        };
      } catch {
        // A thread that never ran a turn has no usage: the card shows that.
        return null;
      }
    },
    [sdk],
  );

  const closeHoverCard = useCallback((force = false) => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (hoverCardTimer.current !== null) {
      clearTimeout(hoverCardTimer.current);
      hoverCardTimer.current = null;
    }
    if (force) {
      setHoverCard(null);
      return;
    }
    hoverCardTimer.current = window.setTimeout(() => {
      if (!isHoveringCard.current) {
        setHoverCard(null);
      }
    }, 220);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      if (hoverCardTimer.current !== null) {
        clearTimeout(hoverCardTimer.current);
        hoverCardTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible) closeHoverCard(true);
  }, [isVisible, closeHoverCard]);

  const hoverOpen = hoverCard !== null;
  useEffect(() => {
    if (!hoverOpen) return;
    const close = () => {
      if (!isHoveringCard.current) {
        setHoverCard(null);
      }
    };
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [hoverOpen]);

  const scheduleHoverCard = () => {
    if (!allowHoverCard || !isVisible) return;
    if (!canHoverPreview()) return;
    if (hoverTimer.current !== null || hoverCard) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The card places and clamps itself once it knows its own size.
      setHoverCard({
        anchor: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        },
      });
    }, 380);
  };

  // Seed the input when editing starts only: an auto-generated title arriving
  // mid-edit must not overwrite what the user is typing.
  const titleRef = useRef(thread.title);
  titleRef.current = thread.title;
  useEffect(() => {
    if (isEditing) {
      cancelledRef.current = false;
      setRenameValue(titleRef.current ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const swipeState = {
    isUnread: thread.isUnread,
    isPinned: thread.isPinned,
    isArchived: thread.isArchived,
  };
  const rightSwipe = swipeActionView(
    swipeRight,
    swipeState,
    listFiltersArchived,
    hasChildren,
  );
  const leftSwipe = swipeActionView(
    swipeLeft,
    swipeState,
    listFiltersArchived,
    hasChildren,
  );
  const togglePin = () => {
    actions.setPinned(thread.id, !thread.isPinned).catch(() => {
      toast.error("Couldn’t update pin");
    });
  };
  const toggleArchive = () => {
    if (thread.isArchived) onUnarchive(thread);
    else actions.archive(thread.id);
  };
  const openInSplit = () => {
    actions.open(thread.id, { split: true });
    onNavigate();
  };
  const runSwipeAction = (action: SwipeActionView, offset: number) => {
    closeHoverCard(true);
    switch (action.id) {
      case "read":
        actions.setRead(thread.id, thread.isUnread).catch(() => {
          toast.error("Couldn’t update read state");
        });
        break;
      case "pin":
        togglePin();
        break;
      case "archive":
        toggleArchive();
        break;
      case "split":
        openInSplit();
        break;
      case "rename":
        onStartRename(thread);
        break;
      case "menu": {
        // The row is still drawn aside by the swipe: anchor on where it rests.
        const rect = rowRef.current?.getBoundingClientRect();
        if (rect) onOpenMenu(rect.right - offset - 220, rect.bottom + 4, thread);
        break;
      }
      case "delete":
        actions.requestDelete(thread.id);
        break;
    }
  };
  const swipeReveal = useRowSwipe({
    rowRef,
    enabled: isVisible && !isEditing && !selectionActive && !!(rightSwipe || leftSwipe),
    right: rightSwipe,
    left: leftSwipe,
    restoreKey: `${thread.isArchived}`,
    onStart: () => closeHoverCard(true),
    onCommit: runSwipeAction,
  });

  const visual: StatusVisual = statusVisualFor(thread.indicator);
  // Action states get the full wash+bar+pulse treatment whether read or not:
  // they stay loud until resolved. Plain unread (FYI-done) keeps the green
  // wash only while unseen.
  const needsUser = thread.indicator === "waiting-for-input";
  const failed =
    thread.indicator === "unread-error" ||
    thread.indicator === "queued-failed";
  // Motion is reserved for rows that need action — FYI-done stays static.
  const actionPulseClass =
    thread.indicator === "waiting-for-input" ||
    thread.indicator === "queued-waiting"
      ? "spooler-row-pulse-amber"
      : thread.indicator === "unread-error" ||
          thread.indicator === "queued-failed"
        ? "spooler-row-pulse-red"
        : null;
  const foldedSummary =
    collapse?.collapsed && collapse.hiddenTotal > 0
      ? foldedKidsText(collapse)
      : null;
  const rowLabel = [
    thread.displayTitle,
    thread.indicatorLabel ?? null,
    thread.isPinned ? "pinned" : null,
    foldedSummary,
  ]
    .filter((part): part is string => !!part)
    .join(" — ");
  const statusWord = statusWordFor(thread.indicator);
  const prNeedsAttention =
    !!pullRequest &&
    !["none", "merged", "closed", "draft"].includes(pullRequest.attention);
  // Quiet rows collapse to title + time; anything worth a glance keeps the
  // full row. Unknown indicators default to full (never hide the unknown).
  const collapsed =
    adaptiveCollapse &&
    !isEditing &&
    !thread.isUnread &&
    thread.indicator === "none" &&
    !hasUnsubmittedDraft &&
    !rowStatus &&
    !prNeedsAttention;

  // Model + thinking only while the thread is in flight. The options
  // endpoint resolves *defaults*, so it reports a model for any thread at
  // all; showing it on an idle one reads as fabricated.
  const showExecution = isLiveThread(thread);
  const execution = useThreadExecution(
    thread.id,
    sdk,
    modelEpoch,
    showExecution,
    thread.latestAttentionAt,
    isVisible,
  );
  const modelName = useModelDisplayName(
    thread.providerId,
    execution?.model ?? null,
    sdk,
    isVisible,
  );

  const branch = thread.environment?.branchName ?? null;
  const hostName = thread.host?.name ?? null;
  const hasBranch = depth === 0 && !!branch;
  // The home host is noise on the row (it stays in the tooltip); branches
  // and away-from-home hosts are always shown.
  const showHost =
    hostName && (!primaryHostId || thread.host?.id !== primaryHostId);
  const where = showHost ? hostName : null;
  // The provider icon identifies the provider, so its name isn't echoed in
  // the grid — except when no icon is available, or in the tooltip.
  const needsProviderText = !providerIcon;
  const thinking =
    execution && execution.reasoningLevel !== "none"
      ? formatReasoningLevel(execution.reasoningLevel)
      : null;
  const fullSubtitle = [
    providerName,
    execution ? modelName : null,
    thinking ? `Thinking: ${thinking}` : null,
    sectionName,
    projectName,
    branch,
    hostName,
    timeText,
  ]
    .filter((part): part is string => !!part)
    .join(" • ");
  const isWorktree = thread.environment?.isWorktree === true;
  const handleCopyBranch = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!branch) return;
    void navigator.clipboard.writeText(branch).then(() => {
      setCopiedBranch(true);
      toast.success(`Copied branch: ${branch}`);
      copiedTimer.current = window.setTimeout(
        () => setCopiedBranch(false),
        1600,
      );
    }).catch(() => {
      toast.error("Could not copy branch");
    });
  };

  // A folded family swaps the live chips for an inline summary of who is
  // hidden: stacked people faces + remainder, names in the tooltip.
  const familyFolded = !!collapse?.collapsed && collapse.hiddenTotal > 0;
  const faceKids = collapse?.hiddenKids.slice(0, 3) ?? [];
  const faceRemainder =
    (collapse?.hiddenTotal ?? 0) - faceKids.length;
  const kidsNode = collapse && familyFolded ? (
    <span className="spooler-kids-line" title={foldedKidsText(collapse)}>
      <span className="spooler-face-stack" aria-hidden="true">
        {faceKids.map((kid) => (
          <span key={kid.id} className="spooler-face">
            <Icon name="UserRound" aria-hidden="true" />
          </span>
        ))}
      </span>
      {faceRemainder > 0 ? (
        <span className="spooler-kids-count">+{faceRemainder}</span>
      ) : null}
    </span>
  ) : null;

  // -- The metadata grid ------------------------------------------------------
  //
  // ONE wrapping chip row under the title carries every fact the row can
  // show — time, project, model + thinking (live only), section, host,
  // branch, PR, and a folded-family summary — each as a chip with its own
  // max-width. The grid wraps onto further lines instead of stacking
  // different kinds on disjointed ones, so every kind reads the same way
  // everywhere it appears. Chips with interactive behavior (branch copy, PR
  // open) keep their buttons; quiet rows fold the whole grid away.
  const gridItems: ReactNode[] = [];
  // Time first: it is the row's heartbeat and reads left-to-right first.
  gridItems.push(
    <span key="time" className="spooler-row-time" title={timeText}>
      {timeText}
    </span>,
  );
  if (projectTag) {
    gridItems.push(
      <span
        key="project"
        className="spooler-row-project"
        title={projectTag}
        style={{
          "--spooler-project-hue": projectColorHue ?? projectHue(thread.projectId),
        } as CSSProperties}
      >
        {projectTag}
      </span>,
    );
  }
  // Model + thinking only while the thread is in flight, and never while a
  // folded family summary stands in for them (the old subtitle swap rule).
  if (showExecution && !familyFolded) {
    if (execution === undefined) {
      gridItems.push(
        <span
          key="model-loading"
          className="spooler-model-loading spooler-grid-secondary"
          role="status"
          aria-label="Loading model"
        />,
      );
    } else if (execution) {
      if (needsProviderText) {
        gridItems.push(
          <span key="provider" className="spooler-host-chip spooler-grid-secondary" title={providerName}>
            {providerName}
          </span>,
        );
      }
      gridItems.push(
        <span key="model" className="spooler-model-chip spooler-grid-secondary" title={modelName ?? undefined}>
          <Icon name="Bot" aria-hidden="true" />
          {modelName}
        </span>,
      );
      if (thinking) {
        gridItems.push(
          <span
            key="thinking"
            className="spooler-model-chip spooler-thinking-chip spooler-grid-secondary"
            title={`Thinking: ${thinking}`}
          >
            <Icon name="Brain" aria-hidden="true" />
            {thinking}
          </span>,
        );
      }
    }
  }
  if (depth === 0 && sectionName && sectionId) {
    gridItems.push(
      <span
        key="section"
        className="spooler-section-chip spooler-grid-secondary"
        style={{ "--spooler-section-hue": projectHue(`section:${sectionId}`) } as CSSProperties}
        title={sectionName}
      >
        {sectionName}
      </span>,
    );
  }
  if (where) {
    gridItems.push(
      <span key="host" className="spooler-host-chip spooler-grid-secondary" title={`Host: ${hostName}`}>
        {hostName}
      </span>,
    );
  }
  if (hasBranch) {
    gridItems.push(
      <button
        key="branch"
        type="button"
        tabIndex={-1}
        className={cn(
          "spooler-branch-btn",
          copiedBranch && "spooler-branch-copied",
        )}
        title={copiedBranch ? "Copied branch to clipboard!" : branch && isWorktree ? `Click to copy branch: ${branch} (worktree)` : `Click to copy branch: ${branch}`}
        aria-label={`Copy branch name ${branch}`}
        onClick={handleCopyBranch}
      >
        <Icon
          name={copiedBranch ? "Check" : (isWorktree ? "FolderGit" : "GitBranch")}
          aria-hidden="true"
          className={cn(copiedBranch && "spooler-tone-success")}
        />
        <span className="spooler-branch-text">{branch}</span>
        {copiedBranch ? (
          <span className="spooler-branch-copied-badge">Copied</span>
        ) : null}
      </button>,
    );
  }
  // The PR badge rides the grid whenever the thread has one — branch or
  // not — so a running thread's PR is never left off the panel.
  if (pullRequest) {
    gridItems.push(
      <button
        key="pr"
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
        <Icon name={prIconName(pullRequest.state, pullRequest.attention)} aria-hidden="true" />
        <span>
          #{pullRequest.number} ·{" "}
          {prLabel(pullRequest.state, pullRequest.attention)}
        </span>
      </button>,
    );
  }
  // A folded family always shows its summary, even on quiet rows — the
  // faces line joins the grid as a full-width item.
  if (familyFolded) {
    gridItems.push(kidsNode);
  }
  const gridNode = (
    <span className="spooler-row-grid" title={fullSubtitle}>
      {gridItems}
    </span>
  );
  const leadNode = (
    <span
      className="spooler-row-lead"
      aria-hidden={selectionActive || isSelected ? undefined : true}
      title={providerIcon ? providerName : undefined}
    >
      {selectionActive || isSelected ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={isSelected ? "Deselect thread" : "Select thread"}
          className={cn(
            "spooler-select-checkbox",
            isSelected && "spooler-select-checkbox-checked",
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(event, thread.id);
          }}
        >
          <Icon name={isSelected ? "Check" : "Circle"} aria-hidden="true" />
        </button>
      ) : providerIcon ? (
        <span className="spooler-provider-icon">
          <ProviderIcon providerKind="agent" provider={providerIcon} />
        </span>
      ) : null}
    </span>
  );
  const gutterNode = (
    <span
      className="spooler-tree-gutter"
      onClick={collapse ? () => collapse.onToggle() : undefined}
      aria-hidden={collapse || dragHandle ? undefined : true}
    >
      {dragHandle ? (
        <button
          type="button"
          className="spooler-row-grip"
          aria-label="Drag onto a section header to file this thread"
          title="Drag onto a section header to file this thread"
          onClick={(event) => event.preventDefault()}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <Icon name="DragDropVertical" aria-hidden="true" />
        </button>
      ) : collapse ? (
        <button
          type="button"
          className="spooler-tree-toggle"
          aria-expanded={!collapse.collapsed}
          aria-label={collapse.collapsed ? "Expand replies" : "Collapse replies"}
          title={collapse.collapsed ? "Expand replies" : "Collapse replies"}
        >
          <Icon
            name={collapse.collapsed ? "ChevronRight" : "ChevronDown"}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  );
  const statusBadge = visual || statusWord ? (
    <span
      className={cn(
        "spooler-row-status-badge",
        celebrate && "spooler-celebrate",
      )}
      title={thread.indicatorLabel ?? undefined}
    >
      {visual?.kind === "spinner" ? (
        <span key="spinner" className="spooler-spinner spooler-tone-success">
          <Icon name="Loading" aria-hidden="true" />
        </span>
      ) : visual?.kind === "icon" ? (
        <span
          key={visual.name}
          className={cn("spooler-status-icon", visual.className)}
        >
          <Icon name={visual.name} aria-hidden="true" />
        </span>
      ) : visual ? (
        <span key="dot" className={cn("spooler-dot", visual.className)} />
      ) : null}
      {statusWord ? (
        <span
          key={statusWord.text}
          className={cn("spooler-status-word", statusWord.tone)}
        >
          {statusWord.text}
        </span>
      ) : null}
    </span>
  ) : null;

  const commit = () => {
    if (cancelledRef.current) return;
    onCommitRename(thread, renameValue);
  };

  if (isEditing) {
    return (
      <div className={cn("spooler-row", isActive && "spooler-row-active")}>
        {gutterNode}
        <div className="spooler-row-main">
          {leadNode}
          <span className="spooler-row-text">
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
                  cancelledRef.current = true;
                  onCancelRename();
                }
              }}
              onBlur={commit}
              aria-label="Rename thread"
              placeholder={thread.displayTitle}
              maxLength={200}
              className="spooler-rename"
            />
            <span className="spooler-row-grid" title={fullSubtitle}>
              {gridItems}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "spooler-row",
        isActive && "spooler-row-active",
        isKeyboardFocused && "spooler-row-keyboard-focused",
        isSelected && "spooler-row-selected",
        density === "compact" && "spooler-row-compact",
        depth === 0 && "spooler-row-root",
        depth === 1 && "spooler-row-child",
        depth > 1 && "spooler-row-deep",
        depth > 0 && isLastChild && "spooler-row-last",
        collapse && "spooler-row-parent",
        splitLayout && "spooler-row-split",
        thread.isUnread && !needsUser && !failed && "spooler-row-unread",
        needsUser && "spooler-row-needs-user",
        failed && "spooler-row-failed",
        actionPulseClass,
        collapsed && "spooler-row-collapsed",
      )}
      ref={rowRef}
      draggable={!isEditing}
      onDragStart={(event) => {
        if (isEditing) return;
        closeHoverCard(true);
        const idsToDrag =
          isSelected && selectedIds && selectedIds.size > 0
            ? Array.from(selectedIds)
            : [thread.id];
        event.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            type: "bb-thread-drag",
            threadIds: idsToDrag,
            title: thread.displayTitle,
          }),
        );
        event.dataTransfer.setData("text/plain", thread.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onMouseEnter={scheduleHoverCard}
      onMouseLeave={() => closeHoverCard(false)}
    >
      {swipeReveal?.action ? (
        <span
          className={cn(
            "spooler-swipe-underlay",
            `spooler-swipe-${swipeReveal.action.id}`,
          )}
          data-side={swipeReveal.side}
          aria-hidden="true"
        >
          <span className="spooler-swipe-content">
            <Icon name={swipeReveal.action.icon} aria-hidden="true" />
            <span className="spooler-swipe-label">{swipeReveal.action.label}</span>
          </span>
        </span>
      ) : null}
      {gutterNode}
      <a
        href={thread.href}
        data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
        data-sidebar-thread-id={thread.id}
        aria-label={rowLabel}
        aria-current={isActive ? "true" : undefined}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        title={thread.displayTitle}
        {...splitProps}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || selectionActive) {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(event, thread.id);
            return;
          }
          onNavigate();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          closeHoverCard(true);
          onOpenMenu(event.clientX, event.clientY, thread);
        }}
        onDoubleClick={(event) => {
          // Double-click the title area renames instead of navigating.
          event.preventDefault();
          onStartRename(thread);
        }}
        className="spooler-row-main"
      >
        {leadNode}
        <span className="spooler-row-text">
          <span className="spooler-row-title">
            <span className="spooler-row-title-text">
              {depth > 0 ? (
                <Icon
                  name="UserRound"
                  aria-hidden="true"
                  className="spooler-child-glyph"
                />
              ) : null}
              {thread.isPinned ? (
                <span
                  className="spooler-pin-marker"
                  title="Pinned"
                  role="img"
                  aria-label="Pinned"
                >
                  <Icon name="Pin" aria-hidden="true" />
                </span>
              ) : null}
              <span className="spooler-thread-title">
                <ThreadTitle threadId={thread.id} />
              </span>
            </span>
            {(() => {
              if (!collapse?.collapsed || collapse.hiddenTotal === 0) {
                return null;
              }
              const dot = hiddenRollupDotClass(collapse);
              if (collapse.hiddenUnread === 0 && !dot) return null;
              return (
                <span
                  className={cn(
                    "spooler-kids-pill",
                    collapse.hiddenUnread > 0 && "spooler-kids-pill-unread",
                  )}
                  title={hiddenSummary(collapse)}
                  aria-label={hiddenSummary(collapse)}
                >
                  {collapse.hiddenUnread > 0 ? (
                    <>
                      <span className="spooler-unread" aria-hidden="true" />
                      {collapse.hiddenUnread}
                    </>
                  ) : null}
                  {dot ? (
                    <span
                      className={cn("spooler-dot", dot)}
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              );
            })()}
          </span>
          <span className="spooler-row-extra">
            <span className="spooler-row-extra-inner">{gridNode}</span>
          </span>
        </span>
        <span className="spooler-row-badges">
          {statusBadge}
          {shortcut ? (
            <kbd className="spooler-kbd">{shortcut.label}</kbd>
          ) : null}
          {rowStatus ? (
            <span
              className={cn("spooler-badge-icon", rowStatusToneClass(rowStatus.tone))}
              title={rowStatus.label}
              role="img"
              aria-label={rowStatus.label}
            >
              <HostIcon name={rowStatus.icon} aria-hidden="true" />
            </span>
          ) : hasUnsubmittedDraft ? (
            <span
              className="spooler-draft-pip"
              title="Unsent draft"
              role="img"
              aria-label="Unsent draft"
            />
          ) : null}
          {thread.isUnread ? (
            <span
              className="spooler-unread"
              role="img"
              aria-label="Unread"
              title="Unread"
            />
          ) : null}
        </span>
      </a>
      <span className="spooler-row-actions">
        <button
          type="button"
          tabIndex={-1}
          aria-label={thread.isPinned ? "Unpin thread" : "Pin thread"}
          aria-pressed={thread.isPinned}
          title={thread.isPinned ? "Unpin" : "Pin"}
          className={cn(
            "spooler-action",
            thread.isPinned && "spooler-action-active",
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePin();
          }}
        >
          <Icon name={thread.isPinned ? "PinOff" : "Pin"} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Rename thread"
          title="Rename"
          className="spooler-action"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartRename(thread);
          }}
        >
          <Icon name="Edit" aria-hidden="true" />
        </button>
        {thread.isArchived ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Unarchive thread"
            title="Unarchive"
            className="spooler-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleArchive();
            }}
          >
            <Icon name="ArchiveRestore" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Archive thread"
            title="Archive"
            className="spooler-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleArchive();
            }}
          >
            <Icon name="Archive" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          className="spooler-action spooler-action-more"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeHoverCard(true);
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(rect.left - 200, rect.bottom + 4, thread);
          }}
        >
          <Icon name="MoreHorizontal" aria-hidden="true" />
        </button>
      </span>
      {hoverCard
        ? createPortal(
            <SpoolerHoverCard
              thread={thread}
              anchor={hoverCard.anchor}
              branch={branch}
              isWorktree={isWorktree}
              pullRequest={pullRequest}
              facts={{
                providerName,
                providerIcon,
                modelName,
                thinking,
                projectName,
                sectionName,
                hostName,
                timeText,
                statusWord: statusWord?.text ?? null,
                statusTone: statusWord?.tone ?? null,
                hiddenKids: collapse?.hiddenKids ?? [],
                hiddenTotal: collapse?.hiddenTotal ?? 0,
              }}
              onOpen={() => {
                actions.open(thread.id);
                onNavigate();
                setHoverCard(null);
              }}
              onOpenSplit={() => {
                openInSplit();
                setHoverCard(null);
              }}
              onTogglePin={togglePin}
              onArchive={toggleArchive}
              onMouseEnter={() => {
                isHoveringCard.current = true;
              }}
              onMouseLeave={() => {
                isHoveringCard.current = false;
                closeHoverCard(true);
              }}
              getContext={fetchThreadContext}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function sameCollapse(a: RowCollapse | null, b: RowCollapse | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // `onToggle` is deliberately not compared: it only closes over the row's own
  // id and a stable toggler, so a fresh closure never changes behaviour.
  return (
    a.collapsed === b.collapsed &&
    a.hiddenTotal === b.hiddenTotal &&
    a.hiddenUnread === b.hiddenUnread &&
    a.hiddenLive === b.hiddenLive &&
    a.hiddenNeedsUser === b.hiddenNeedsUser &&
    a.hiddenFailed === b.hiddenFailed &&
    a.hiddenKids.length === b.hiddenKids.length &&
    a.hiddenKids.every((kid, index) => {
      const other = b.hiddenKids[index];
      return (
        kid.id === other.id && kid.title === other.title && kid.dot === other.dot
      );
    })
  );
}

type RowProps = React.ComponentProps<typeof SpoolerThreadRowImpl>;

/**
 * Rows re-render only when something they show changed. The list rebuilds the
 * `collapse` object every render, so it is compared by value; everything else
 * is compared by identity.
 */
export const SpoolerThreadRow = memo(SpoolerThreadRowImpl, (prev, next) => {
  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]) as Set<keyof RowProps>;
  for (const key of keys) {
    if (key === "collapse") {
      if (!sameCollapse(prev.collapse, next.collapse)) return false;
    } else if (!Object.is(prev[key], next[key])) {
      return false;
    }
  }
  return true;
});
