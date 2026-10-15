import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RowProviderIcon } from "./SpoolerThreadRow";

export interface ContextCategory {
  id: string;
  label: string;
  kind: "used" | "reserved" | "free" | "deferred";
  tokens: number;
  entries: { id: string; label: string; tokens: number }[];
}

export interface ContextUsage {
  usedTokens: number;
  modelContextWindow: number;
  estimated?: boolean;
  autoCompactAtTokens?: number | null;
  categories?: ContextCategory[];
}

/** Facts the row already has, handed over so the card costs no extra fetches. */
export interface HoverCardFacts {
  providerName: string;
  providerIcon: RowProviderIcon | null;
  modelName: string | null;
  thinking: string | null;
  projectName: string;
  sectionName: string | null;
  hostName: string | null;
  timeText: string;
  statusWord: string | null;
  statusTone: string | null;
  hiddenKids: { id: string; title: string }[];
  hiddenTotal: number;
}

/**
 * Solid, hue-separated fills. Mixing with `transparent` washed the segments
 * out against the track, so each tone is instead pulled toward the
 * foreground: legible on light and dark palettes, and distinct from its
 * neighbours without relying on opacity.
 */
const CATEGORY_COLOR: Record<ContextCategory["kind"], string> = {
  used: "var(--primary)",
  reserved:
    "color-mix(in srgb, var(--warning, #b98533) 78%, var(--foreground))",
  deferred:
    "color-mix(in srgb, var(--muted-foreground) 62%, var(--foreground))",
  free: "transparent",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export function SpoolerHoverCard({
  thread,
  anchor,
  branch,
  isWorktree,
  pullRequest,
  facts,
  onOpen,
  onOpenSplit,
  onTogglePin,
  onArchive,
  onMouseEnter,
  onMouseLeave,
  getContext,
}: {
  thread: PluginSidebarThread;
  anchor: { top: number; bottom: number; left: number; right: number };
  branch: string | null;
  isWorktree: boolean;
  pullRequest: PluginSidebarPullRequest | null;
  facts: HoverCardFacts;
  onOpen: () => void;
  onOpenSplit: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  getContext?: (threadId: string) => Promise<ContextUsage | null>;
}) {
  const [context, setContext] = useState<ContextUsage | null>(null);
  const [copiedBranch, setCopiedBranch] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The card unmounts whenever the pointer leaves, so the "copied" reset
  // must not be left firing against a dead component.
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Place the card against the row, then clamp it fully inside the viewport.
  // Runs before paint, so the card never shows at a wrong position.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const margin = 8;
    const gap = 10;
    // offsetWidth/Height ignore transforms, so the entrance animation's
    // scale() can't skew the measurement the way getBoundingClientRect would.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.right + gap;
    let side = "right";
    if (left + width > vw - margin) {
      left = anchor.left - gap - width;
      side = "left";
    }
    // Neither side fits (narrow window): pin inside the viewport anyway.
    if (left < margin) left = margin;
    if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);

    let top = anchor.top;
    if (top + height > vh - margin) top = vh - margin - height;
    if (top < margin) top = margin;

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.dataset.side = side;

    // Keep the arrow pointing at the row even after the card is nudged.
    const rowMid = (anchor.top + anchor.bottom) / 2;
    const arrow = Math.min(Math.max(rowMid - top, 14), Math.max(height - 14, 14));
    el.style.setProperty("--spooler-arrow-y", `${Math.round(arrow)}px`);
  }, [anchor, context, copiedBranch]);

  useEffect(() => {
    if (!getContext) return;
    let cancelled = false;
    setContext(null);
    getContext(thread.id)
      .then((data) => {
        if (!cancelled) setContext(data);
      })
      .catch(() => {
        // No usage recorded: the section simply stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, getContext]);

  const copyBranch = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!branch) return;
    try {
      await navigator.clipboard.writeText(branch);
      setCopiedBranch(true);
      toast.success(`Copied ${branch}`);
      copiedTimer.current = window.setTimeout(
        () => setCopiedBranch(false),
        1600,
      );
    } catch {
      toast.error("Couldn't copy branch");
    }
  };

  const maxTokens = context?.modelContextWindow ?? 0;
  const usedTokens = context?.usedTokens ?? 0;
  const pct = maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0;
  const compactPct =
    context?.autoCompactAtTokens && maxTokens
      ? Math.min(100, (context.autoCompactAtTokens / maxTokens) * 100)
      : null;
  // A stacked bar only reads well with real categories; otherwise a plain fill.
  const categories = (context?.categories ?? []).filter(
    (category) => category.kind !== "free" && category.tokens > 0,
  );
  const topCategories = [...categories]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4);

  const goal =
    thread.titleFallback && thread.titleFallback !== thread.displayTitle
      ? thread.titleFallback
      : null;

  return (
    <div
      ref={cardRef}
      className="spooler-hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="dialog"
      aria-label={thread.displayTitle}
    >
      {/* ---------- Header ---------- */}
      <div className="spooler-hover-head">
        <div className="spooler-hover-head-row">
          <span className="spooler-hover-provider" title={facts.providerName}>
            {facts.providerIcon ? (
              <span className="spooler-hover-provider-icon">
                <ProviderIcon
                  providerKind="agent"
                  provider={facts.providerIcon}
                />
              </span>
            ) : (
              <Icon name="Bot" aria-hidden="true" />
            )}
          </span>
          <span className="spooler-hover-title">{thread.displayTitle}</span>
        </div>
        <div className="spooler-hover-head-meta">
          {facts.statusWord ? (
            <span className={cn("spooler-hover-status", facts.statusTone)}>
              {facts.statusWord}
            </span>
          ) : null}
          <span>{facts.providerName}</span>
          <span aria-hidden="true">·</span>
          <span>{facts.timeText}</span>
        </div>
      </div>

      {/* ---------- Goal ---------- */}
      {goal ? (
        <p className="spooler-hover-goal">
          <span className="spooler-hover-goal-label">Goal</span>
          {goal}
        </p>
      ) : null}

      {/* ---------- Model / scope chips ---------- */}
      <div className="spooler-hover-chips">
        {facts.modelName ? (
          <span className="spooler-hover-chip spooler-hover-chip-strong">
            <Icon name="Bot" aria-hidden="true" />
            {facts.modelName}
          </span>
        ) : null}
        {facts.thinking ? (
          <span className="spooler-hover-chip">
            <Icon name="Brain" aria-hidden="true" />
            {facts.thinking}
          </span>
        ) : null}
        {facts.sectionName ? (
          <span className="spooler-hover-chip">
            <Icon name="SectionMove" aria-hidden="true" />
            {facts.sectionName}
          </span>
        ) : null}
        <span className="spooler-hover-chip">
          <Icon name="Folder" aria-hidden="true" />
          {facts.projectName}
        </span>
        {facts.hostName ? (
          <span className="spooler-hover-chip">
            <Icon name="Laptop" aria-hidden="true" />
            {facts.hostName}
          </span>
        ) : null}
      </div>

      {/* ---------- Git ---------- */}
      {branch || pullRequest ? (
        <div className="spooler-hover-git">
          {branch ? (
            <button
              type="button"
              className="spooler-hover-git-row"
              title="Copy branch name"
              onClick={copyBranch}
            >
              <Icon
                name={
                  copiedBranch
                    ? "Check"
                    : isWorktree
                      ? "FolderGit"
                      : "GitBranch"
                }
                aria-hidden="true"
              />
              <span className="spooler-hover-git-text">{branch}</span>
              <span className="spooler-hover-git-hint">
                {copiedBranch ? "Copied" : "Copy"}
              </span>
            </button>
          ) : null}
          {pullRequest ? (
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="spooler-hover-git-row"
              title={`Open PR #${pullRequest.number}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Icon
                name={
                  pullRequest.state === "merged"
                    ? "GitMerge"
                    : pullRequest.state === "draft"
                      ? "GitPullRequestDraft"
                      : pullRequest.state === "closed"
                        ? "GitPullRequestClosed"
                        : "GitPullRequest"
                }
                aria-hidden="true"
              />
              <span className="spooler-hover-git-text">
                <span className={cn("spooler-hover-pr", `spooler-pr-${pullRequest.state}`)}>
                  #{pullRequest.number}
                </span>{" "}
                {pullRequest.title}
              </span>
              <Icon name="ExternalLink" aria-hidden="true" className="spooler-hover-git-ext" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* ---------- Context window: only when BB records usage ---------- */}
      {context ? (
        <div className="spooler-hover-context">
          <div className="spooler-hover-context-head">
            <span className="spooler-hover-context-title">Context</span>
            <span className="spooler-hover-context-values">
              <strong>{formatTokens(usedTokens)}</strong>
              <span className="spooler-hover-context-sep">
                / {maxTokens ? formatTokens(maxTokens) : "?"}
              </span>
              <span
                className={cn(
                  "spooler-hover-context-pct",
                  pct > 85 && "spooler-pct-critical",
                  pct > 60 && pct <= 85 && "spooler-pct-warning",
                )}
              >
                {pct}%
              </span>
            </span>
          </div>
          <div
            className="spooler-hover-bar"
            role="img"
            aria-label={`${pct}% of ${formatTokens(maxTokens)} tokens used`}
          >
            {categories.length > 0 ? (
              categories.map((category) => (
                <span
                  key={category.id}
                  className="spooler-hover-bar-seg"
                  style={{
                    width: `${(category.tokens / maxTokens) * 100}%`,
                    background: CATEGORY_COLOR[category.kind],
                  }}
                  title={`${category.label}: ${formatTokens(category.tokens)}`}
                />
              ))
            ) : (
              <span
                className={cn(
                  "spooler-hover-bar-seg",
                  pct > 85
                    ? "spooler-token-critical"
                    : pct > 60
                      ? "spooler-token-warning"
                      : "spooler-token-normal",
                )}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            )}
            {compactPct !== null ? (
              <span
                className="spooler-hover-bar-mark"
                style={{ left: `${compactPct}%` }}
                title={`Auto-compacts at ${formatTokens(context.autoCompactAtTokens ?? 0)}`}
              />
            ) : null}
          </div>
          {topCategories.length > 0 ? (
            <div className="spooler-hover-legend">
              {topCategories.map((category) => (
                <span key={category.id} className="spooler-hover-legend-item">
                  <span
                    className="spooler-hover-legend-dot"
                    style={{ background: CATEGORY_COLOR[category.kind] }}
                    aria-hidden="true"
                  />
                  {category.label}
                  <span className="spooler-hover-legend-tokens">
                    {formatTokens(category.tokens)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- Folded family ---------- */}
      {facts.hiddenTotal > 0 ? (
        <div className="spooler-hover-kids">
          <Icon name="UserRound" aria-hidden="true" />
          <span>
            {facts.hiddenKids.map((kid) => kid.title).join(", ")}
            {facts.hiddenTotal > facts.hiddenKids.length
              ? ` +${facts.hiddenTotal - facts.hiddenKids.length}`
              : ""}
          </span>
        </div>
      ) : null}

      {/* ---------- Actions ---------- */}
      <div className="spooler-hover-actions">
        <button
          type="button"
          className="spooler-hover-action spooler-hover-action-primary"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <Icon name="ArrowUpRight" aria-hidden="true" />
          Open
        </button>
        <button
          type="button"
          className="spooler-hover-action"
          title="Open in a split pane"
          onClick={(event) => {
            event.stopPropagation();
            onOpenSplit();
          }}
        >
          <Icon name="Columns2" aria-hidden="true" />
          Split
        </button>
        <button
          type="button"
          className={cn("spooler-hover-action", thread.isPinned && "spooler-hover-action-on")}
          title={thread.isPinned ? "Unpin thread" : "Pin thread"}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        >
          <Icon name={thread.isPinned ? "PinOff" : "Pin"} aria-hidden="true" />
          {thread.isPinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          className="spooler-hover-action"
          title={thread.isArchived ? "Move back to active" : "Archive thread"}
          onClick={(event) => {
            event.stopPropagation();
            onArchive();
          }}
        >
          <Icon
            name={thread.isArchived ? "ArchiveRestore" : "Archive"}
            aria-hidden="true"
          />
          {thread.isArchived ? "Restore" : "Archive"}
        </button>
      </div>
    </div>
  );
}
