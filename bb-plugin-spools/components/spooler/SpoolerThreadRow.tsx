import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ThreadTitle,
  experimental_Icon as HostIcon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarThreadSplit,
  useBbNavigate,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginBrowserBbSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { type SpoolerThreadActions } from "./useThreadRowActions";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  formatReasoningLevel,
  useModelDisplayName,
  useThreadExecution,
} from "./useThreadExecution";
import { ThreadDetailFacts, type ContextUsage } from "./SpoolerThreadDetails";
import { useEnvironmentPullRequest } from "./usePullRequest";
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
  /** Counts behind the booleans: the sub-head's rollup reads "1 needs you". */
  hiddenNeedsUserCount: number;
  hiddenFailedCount: number;
  hiddenKids: { id: string; title: string; dot: string | null }[];
  onToggle: () => void;
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
    case "working-draft":
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
    case "waiting-for-input":
    case "queued-waiting":
      return { kind: "dot", className: "spooler-dot-attention spooler-dot-pulse" };
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

/** Visual tone for a pull request's attention. */
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

/** Pill class for a pull request state. */
export function prBadgeClass(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "spooler-pr-merged";
  if (state === "closed" || attention === "closed") return "spooler-pr-closed";
  if (state === "draft" || attention === "draft") return "spooler-pr-draft";
  return "spooler-pr-open";
}

/** Icon for a pull request state. */
export function prIconName(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "GitMerge";
  if (state === "closed" || attention === "closed") return "GitPullRequestClosed";
  if (state === "draft" || attention === "draft") return "GitPullRequestDraft";
  return "GitPullRequest";
}

/**
 * The sub-head's first slot: a pill (attention/failed) or a plain tinted
 * word (working). Canonical wording only — the host's raw indicator label
 * stays in the row's accessible name. Done reads nothing: the check glyph
 * and the unread dot carry it.
 */
function statusMetaFor(
  indicator: string,
): { text: string; tone: string; pill: boolean } | null {
  switch (indicator) {
    case "runtime":
    case "working-draft":
      return { text: "Working", tone: "spooler-tone-success", pill: false };
    case "background-agent":
      return {
        text: "Working · Agent",
        tone: "spooler-tone-success",
        pill: false,
      };
    case "background-command":
      return {
        text: "Working · Command",
        tone: "spooler-tone-success",
        pill: false,
      };
    case "workflow":
      return {
        text: "Working · Workflow",
        tone: "spooler-tone-success",
        pill: false,
      };
    case "goal":
      return {
        text: "Working · Goal",
        tone: "spooler-tone-success",
        pill: false,
      };
    case "plan-mode":
      return {
        text: "Working · Plan",
        tone: "spooler-tone-success",
        pill: false,
      };
    case "waiting-for-input":
      return {
        text: "Needs you",
        tone: "spooler-pill-attention",
        pill: true,
      };
    case "queued-waiting":
      return {
        text: "Queued",
        tone: "spooler-pill-attention",
        pill: true,
      };
    case "unread-error":
    case "queued-failed":
      return {
        text: "Failed",
        tone: "spooler-pill-failed",
        pill: true,
      };
    default:
      return null;
  }
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
  adaptiveCollapse = true,
  isActive,
  isEditing,
  isVisible = true,
  actions,
  timeText,
  /** The same age as `timeText`, in the short row form: "now", "12m", "2d".
   *  A string, like `timeText`, so the minute tick re-renders only rows whose
   *  label moved. */
  timeShortText,
  onNavigate,
  onOpenMenu,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onUnarchive,
  providerName,
  providerIcon,
  projectTag,
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
  /** Plugin setting: gate the quiet-row fold. */
  adaptiveCollapse?: boolean;
  isActive: boolean;
  isEditing: boolean;
  /** False inside a folded group or ancestor; suspend requests and gestures. */
  isVisible?: boolean;
  actions: SpoolerThreadActions;
  /** Relative activity time, e.g. "5m ago" — the SUB-head's full tooltip. */
  timeText: string;
  /** The short sub-head form of the same age: "now", "12m", "2d". */
  timeShortText?: string;
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
  const pullRequest = useEnvironmentPullRequest(thread.environment?.id);
  const navigate = useBbNavigate();
  const { splitProps, layout: splitLayout } =
    experimental_useSidebarThreadSplit(thread.id);

  const [renameValue, setRenameValue] = useState("");
  const [copiedBranch, setCopiedBranch] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Inline Details: per-row disclosure behind the chevron. Selecting a
  // thread only paints the selected tone — the panel never opens on its
  // own. Per-row state means several boxes can be open side by side.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `spooler-details-${thread.id.replace(/[^a-zA-Z0-9-]/g, "_")}`;
  // The row's trailing buttons join the tab order only while the row itself
  // holds focus: the row is the roving tab stop.
  const [rowFocusWithin, setRowFocusWithin] = useState(false);
  // Context usage is fetched once per row, lazily on first open.
  // `undefined` in the cache means "not resolved yet", as a marker for the
  // in-flight fetch.
  const contextCacheRef = useRef<ContextUsage | null | undefined>(undefined);
  const [context, setContext] = useState<ContextUsage | null>(null);
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
        // A thread that never ran a turn has no usage: the panel shows that.
        return null;
      }
    },
    [sdk],
  );

  const ensureContext = useCallback(() => {
    if (contextCacheRef.current !== undefined) {
      setContext(contextCacheRef.current);
      return;
    }
    contextCacheRef.current = null;
    fetchThreadContext(thread.id)
      .then((usage) => {
        contextCacheRef.current = usage;
        setContext(usage);
      })
      .catch(() => {
        // The cache stays null: the context section is simply omitted.
      });
  }, [fetchThreadContext, thread.id]);

  // Context arrives on first open only (the cache suppresses re-fetches).
  useEffect(() => {
    if (!detailsOpen) return;
    ensureContext();
  }, [detailsOpen, ensureContext]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
    };
  }, []);

  // Model + effort live in the details and resolve for ANY thread — the
  // options endpoint answers with the thread's defaults, so idle rows show
  // them too. The fetch is gated to the OPEN row's details: nothing pays for
  // the request while the panel is closed.
  const execution = useThreadExecution(
    thread.id,
    sdk,
    modelEpoch,
    detailsOpen,
    thread.latestAttentionAt,
    isVisible,
  );
  const modelName = useModelDisplayName(
    thread.providerId,
    execution?.model ?? null,
    sdk,
    detailsOpen,
  );

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
  const toggleDetails = () => {
    setDetailsOpen((open) => {
      const next = !open;
      if (next) ensureContext();
      return next;
    });
  };
  const runSwipeAction = (action: SwipeActionView, offset: number) => {
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
    onCommit: runSwipeAction,
  });

  const visual: StatusVisual = statusVisualFor(thread.indicator);
  const needsUser = thread.indicator === "waiting-for-input";
  const failed =
    thread.indicator === "unread-error" ||
    thread.indicator === "queued-failed";
  const done = thread.indicator === "unread-success";
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
  // The sub-head's first slot: a pill (Needs you / Queued / Failed) or a
  // tinted working word ("Working · Command"). Canonical wording only.
  const statusMeta = statusMetaFor(thread.indicator);

  const prNeedsAttention =
    !!pullRequest &&
    !["none", "merged", "closed", "draft"].includes(pullRequest.attention);
  // Quiet rows are sub-head + action chrome only: no PR chip (the PR already
  // needs attention or it belongs in the details), no status word (idle rows
  // have none). Anything worth a glance keeps its slots.
  const collapsed =
    adaptiveCollapse &&
    !isEditing &&
    !thread.isUnread &&
    thread.indicator === "none" &&
    !hasUnsubmittedDraft &&
    !rowStatus &&
    !prNeedsAttention;

  const branch = thread.environment?.branchName ?? null;
  const hostName = thread.host?.name ?? null;
  // The home host is noise; away-from-home hosts are the exception the
  // Details list shows.
  const detailHostName =
    hostName && (!primaryHostId || thread.host?.id !== primaryHostId)
      ? hostName
      : null;
  const thinking =
    execution && execution.reasoningLevel !== "none"
      ? formatReasoningLevel(execution.reasoningLevel)
      : null;
  const isWorktree = thread.environment?.isWorktree === true;
  const handleCopyBranch = (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!branch) return;
    if (!navigator.clipboard) {
      toast.error("Could not copy branch");
      return;
    }
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
  const handleOpenPr = () => {
    if (!pullRequest) return;
    navigate.openUrl(pullRequest.url);
  };

  // A folded family keeps status · provider · time on the sub-head's left,
  // and adds the rollup to the right cluster: "N replies · ● loudest".
  const familyFolded = !!collapse?.collapsed && collapse.hiddenTotal > 0;
  const familyRollup = familyFolded
    ? collapse!.hiddenFailedCount > 0
      ? {
          dot: "spooler-dot-error",
          tone: "spooler-tone-error",
          text: `${collapse!.hiddenFailedCount} failed`,
        }
      : collapse!.hiddenNeedsUserCount > 0
        ? {
            dot: "spooler-dot-attention",
            tone: "spooler-tone-warning",
            text: `${collapse!.hiddenNeedsUserCount} needs you`,
          }
        : collapse!.hiddenUnread > 0
          ? {
              dot: "spooler-dot-unread",
              tone: "spooler-tone-muted",
              text: `${collapse!.hiddenUnread} unread`,
            }
          : collapse!.hiddenLive
            ? {
                dot: "spooler-dot-running",
                tone: "spooler-tone-success",
                text: "working",
              }
            : null
    : null;

  // Shared facts for the details body. Provider and section are absent on
  // purpose (the row's header carries the provider; the sidebar carries the
  // section); status lives in the sub-head too, so no Status row here.
  const facts = {
    goal:
      thread.titleFallback && thread.titleFallback !== thread.displayTitle
        ? thread.titleFallback
        : null,
    model: detailsOpen ? (execution === undefined ? null : modelName) : null,
    thinking,
    hostName: detailHostName,
    branch,
    isWorktree,
    pullRequest,
    replies:
      collapse && collapse.hiddenTotal > 0
        ? { hiddenTotal: collapse.hiddenTotal, hiddenKids: collapse.hiddenKids }
        : null,
    context,
  };

  const commit = () => {
    if (cancelledRef.current) return;
    onCommitRename(thread, renameValue);
  };

  // -- Row anatomy ----------------------------------------------------------
  //
  // The box: a header tube (the row's default content — provider icon,
  // stateful lead, title over provider · time | PR · project) plus the
  // details appended flush beneath it when the chevron opens them. The
  // washes (hover/selected) paint the tube only; the panel is its own
  // surface, so tones layer vertically and never squeeze sideways.

  const gutterNode = (
    <span className="spooler-tree-gutter" aria-hidden="true">
      {providerIcon ? (
        <span
          className="spooler-row-provider"
          title={`Provider: ${providerName}`}
        >
          <ProviderIcon providerKind="agent" provider={providerIcon} />
        </span>
      ) : null}
    </span>
  );

  const leadNode = (
    <span
      className={"spooler-row-lead"}
      aria-hidden={
        !collapse && !(selectionActive || isSelected) ? true : undefined
      }
    >
      {collapse ? (
        // The family fold toggle stays in the lead even while selection is
        // active: pruning a selection happens through the fold, and the row
        // itself still selects (ctrl-click) when a dock is open.
        <button
          type="button"
          tabIndex={-1}
          className="spooler-tree-toggle"
          aria-expanded={!collapse.collapsed}
          aria-label={collapse.collapsed ? "Expand replies" : "Collapse replies"}
          title={collapse.collapsed ? "Expand replies" : "Collapse replies"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            collapse.onToggle();
          }}
        >
          <Icon
            name={collapse.collapsed ? "ChevronRight" : "ChevronDown"}
            aria-hidden="true"
          />
        </button>
      ) : selectionActive || isSelected ? (
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
      ) : visual ? (
        <span
          className={cn(
            "spooler-status-glyph",
            celebrate && done && "spooler-celebrate",
            visual.kind === "icon" && visual.className,
          )}
          title={thread.indicatorLabel ?? undefined}
        >
          {visual.kind === "spinner" ? (
            <span className="spooler-spinner spooler-tone-success">
              <Icon name="Loading" aria-hidden="true" />
            </span>
          ) : visual.kind === "icon" ? (
            <Icon name={visual.name} aria-hidden="true" />
          ) : (
            <span
              key="dot"
              className={cn("spooler-dot", visual.className)}
              aria-hidden="true"
            />
          )}
        </span>
      ) : (
        <span className="spooler-lead-empty" aria-hidden="true" />
      )}
    </span>
  );

  // The main line's trailing cluster (fixed to the right, never wrapped):
  // unread ink dot, keyboard shortcut, another plugin's row status, the
  // unsent-draft pip, then the PERMANENT ⋯ and the details chevron. The
  // short time is NOT here — it lives on the sub-head.
  const titleTrailNode = (
    <span className="spooler-row-badges">
      {thread.isUnread ? (
        <span
          className="spooler-unread"
          role="img"
          aria-label="Unread"
          title="Unread"
        />
      ) : null}
      {shortcut ? (
        <kbd className="spooler-kbd">{shortcut.label}</kbd>
      ) : null}
      {rowStatus ? (
        <span
          className={cn(
            "spooler-badge-icon",
            rowStatusToneClass(rowStatus.tone),
          )}
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
      <button
        type="button"
        tabIndex={rowFocusWithin ? 0 : -1}
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        className="spooler-row-more"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom + 4, thread);
        }}
      >
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button>
      <button
        type="button"
        tabIndex={rowFocusWithin ? 0 : -1}
        aria-label={detailsOpen ? "Hide details" : "Show details"}
        title={detailsOpen ? "Hide details" : "Show details"}
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        className="spooler-row-toggle"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleDetails();
        }}
      >
        <Icon name="ChevronDown" aria-hidden="true" />
      </button>
    </span>
  );

  // The sub-head: status word/pill (tone) · provider · short time on the
  // left; the folded-family rollup, the pull request chip and the project —
  // RIGHT-justified — on the right. Project truncates first; the same
  // geometry serves the collapsed and the expanded box, so the outer row
  // never duplicates or jams next to the panel.
  const subHeadNode = (
    <span className="spooler-row-sub">
      <span className="spooler-row-sub-left">
        {statusMeta && !collapsed ? (
          statusMeta.pill ? (
            <span
              key="status-pill"
              className={cn("spooler-status-pill", statusMeta.tone)}
              title={thread.indicatorLabel ?? undefined}
            >
              {statusMeta.text}
            </span>
          ) : (
            <span
              key="status-word"
              className={cn("spooler-status-wording", statusMeta.tone)}
              title={thread.indicatorLabel ?? undefined}
            >
              {statusMeta.text}
            </span>
          )
        ) : null}
        <span
          className="spooler-row-sub-prov"
          title={`Provider: ${providerName}`}
        >
          {providerName}
        </span>
        <span className="spooler-row-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className="spooler-row-time" title={timeText}>
          {timeShortText}
        </span>
      </span>
      <span className="spooler-row-sub-push" />
      <span className="spooler-row-sub-right">
        {familyFolded ? (
          <>
            <span
              key="replies"
              className="spooler-row-replies"
              title={foldedKidsText(collapse!)}
            >
              {collapse!.hiddenTotal} replies
            </span>
            {familyRollup ? (
              <>
                <span
                  key="rollup-sep"
                  className="spooler-row-meta-sep"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span
                  key="rollup"
                  className={cn("spooler-row-rollup", familyRollup.tone)}
                >
                  <span
                    className={cn("spooler-dot", familyRollup.dot)}
                    aria-hidden="true"
                  />
                  {familyRollup.text ? (
                    <span>{familyRollup.text}</span>
                  ) : null}
                </span>
              </>
            ) : null}
          </>
        ) : null}
        {pullRequest && !collapsed ? (
          <button
            key="pr"
            type="button"
            tabIndex={-1}
            className={cn("spooler-pr-link", prToneClass(pullRequest.attention))}
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
              #{pullRequest.number}
            </span>
          </button>
        ) : null}
        {projectTag ? (
          <span key="project" className="spooler-row-project" title={projectTag}>
            {projectTag}
          </span>
        ) : null}
      </span>
    </span>
  );

  const mainBodyNode = (input: boolean) => (
    <span className="spooler-row-text">
      <span className="spooler-row-head">
        {input ? (
          <span className="spooler-row-title">
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
          </span>
        ) : (
          <span className="spooler-row-title">
            <span className="spooler-row-title-text">
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
          </span>
        )}
        {titleTrailNode}
      </span>
      {subHeadNode}
    </span>
  );

  if (isEditing) {
    return (
      <div
        className={cn(
          "spooler-row",
          isActive && "spooler-row-active",
          density === "compact" && "spooler-row-compact",
          depth === 0 && "spooler-row-root",
          depth === 1 && "spooler-row-child",
          depth > 1 && "spooler-row-deep",
          depth > 0 && isLastChild && "spooler-row-last",
        )}
        ref={rowRef}
      >
        <a
          href={thread.href}
          onClick={(event) => event.preventDefault()}
          className="spooler-row-main"
        >
          {gutterNode}
          {leadNode}
          {mainBodyNode(true)}
        </a>
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
        done && "spooler-row-done",
        collapsed && "spooler-row-collapsed",
        detailsOpen && "spooler-row-open",
      )}
      ref={rowRef}
      onFocusCapture={() => setRowFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setRowFocusWithin(false);
        }
      }}
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
          onOpenMenu(event.clientX, event.clientY, thread);
        }}
        onDoubleClick={(event) => {
          // Double-click the title area renames instead of navigating.
          event.preventDefault();
          onStartRename(thread);
        }}
        className="spooler-row-main"
      >
        {gutterNode}
        {leadNode}
        {mainBodyNode(false)}
      </a>
      {detailsOpen ? (
        <div
          id={detailsId}
          className="spooler-row-details"
          role="region"
          aria-label={`${thread.displayTitle} details`}
        >
          <div className="spooler-row-details-sep" aria-hidden="true" />
          <ThreadDetailFacts
            {...facts}
            copiedBranch={copiedBranch}
            onCopyBranch={() => handleCopyBranch()}
            onOpenPr={handleOpenPr}
          />
          <div className="spooler-details-actions">
            <button
              type="button"
              className="spooler-details-open"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.open(thread.id);
                onNavigate();
              }}
            >
              Open
            </button>
            <button
              type="button"
              className="spooler-details-split"
              title="Open in a split pane"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openInSplit();
              }}
            >
              Split
            </button>
          </div>
        </div>
      ) : null}
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
    a.hiddenNeedsUserCount === b.hiddenNeedsUserCount &&
    a.hiddenFailedCount === b.hiddenFailedCount &&
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
