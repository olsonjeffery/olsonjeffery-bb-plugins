// ThreadDetailFacts: the shared "definition list of facts" for a thread's
// inline Details panel. The list is pure presentation: interactive bits
// (branch copy, PR open) arrive as callbacks; the provider lives in the
// panel's header (the row renders it), so the list carries no Provider row —
// and the section lives in the sidebar itself, so no Section row either.
// Model/effort is always part of the list: defaults resolve for any thread.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { prLabel, prIconName } from "./SpoolerThreadRow";
import type {
  SpoolPullRequest,
} from "./usePullRequest";

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

/** Facts the row already knows; the component adds only formatting. */
export interface ThreadDetailFactsProps {
  goal: string | null;
  statusLabel: string | null;
  model: string | null;
  thinking: string | null;
  /** Away-from-home host only (the list filters it before us). */
  hostName: string | null;
  branch: string | null;
  isWorktree: boolean;
  pullRequest: SpoolPullRequest | null;
  replies: ThreadDetailReplyInfo | null;
  timeText: string;
  /** Usage recorded by BB; null omits the context section. */
  context: ContextUsage | null;
  copiedBranch: boolean;
  onCopyBranch?: () => void;
  onOpenPr?: () => void;
}

export interface ThreadDetailReplyInfo {
  hiddenTotal: number;
  hiddenKids: { id: string; title: string }[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

/**
 * Solid, hue-separated fills. Mixing with `transparent` washed the segments
 * out against the track, so each tone is instead pulled toward the
 * foreground: legible on light and dark palettes, and distinct from its
 * neighbours without relying on opacity.
 */
const CATEGORY_COLOR: Record<string, string> = {
  used: "var(--primary)",
  reserved:
    "color-mix(in srgb, var(--warning) 78%, var(--foreground))",
  deferred:
    "color-mix(in srgb, var(--muted-foreground) 62%, var(--foreground))",
  free: "transparent",
};

export function ThreadDetailFacts({
  goal,
  statusLabel,
  model,
  thinking,
  hostName,
  branch,
  isWorktree,
  pullRequest,
  replies,
  timeText,
  context,
  copiedBranch,
  onCopyBranch,
  onOpenPr,
}: ThreadDetailFactsProps) {
  const maxTokens = context?.modelContextWindow ?? 0;
  const usedTokens = context?.usedTokens ?? 0;
  const pct =
    maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0;
  const compactPct =
    context?.autoCompactAtTokens && maxTokens
      ? Math.min(100, (context.autoCompactAtTokens / maxTokens) * 100)
      : null;
  // A stacked bar only reads well with real categories; otherwise a plain fill.
  const categories = (context?.categories ?? []).filter(
    (category) => category.kind !== "free" && category.tokens > 0,
  );

  return (
    <dl className="spooler-details-dl">
      {goal ? (
        <>
          <dt className="spooler-details-dt">Goal</dt>
          <dd className="spooler-details-dd spooler-details-goal">{goal}</dd>
        </>
      ) : null}
      {statusLabel ? (
        <>
          <dt className="spooler-details-dt">Status</dt>
          <dd className="spooler-details-dd">
            {statusLabel}
            {timeText ? (
              <span className="spooler-details-muted"> · {timeText}</span>
            ) : null}
          </dd>
        </>
      ) : null}
      {model ? (
        <>
          <dt className="spooler-details-dt">Model</dt>
          <dd className="spooler-details-dd">
            {model}
            {thinking ? (
              <span className="spooler-details-muted"> · effort {thinking}</span>
            ) : null}
          </dd>
        </>
      ) : null}
      {hostName ? (
        <>
          <dt className="spooler-details-dt">Host</dt>
          <dd className="spooler-details-dd">{hostName}</dd>
        </>
      ) : null}
      {branch ? (
        <>
          <dt className="spooler-details-dt">Branch</dt>
          <dd className="spooler-details-dd spooler-details-branch">
            <span className="spooler-details-branch-text">{branch}</span>
            <button
              type="button"
              tabIndex={-1}
              className="spooler-details-copy"
              aria-label={`Copy branch name ${branch}`}
              title={copiedBranch ? "Copied branch to clipboard!" : isWorktree ? `Copy branch (worktree)` : "Copy branch"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCopyBranch?.();
              }}
            >
              <Icon
                name={copiedBranch ? "Check" : isWorktree ? "FolderGit" : "GitBranch"}
                aria-hidden="true"
                className={cn(copiedBranch && "spooler-tone-success")}
              />
            </button>
          </dd>
        </>
      ) : null}
      {pullRequest ? (
        <>
          <dt className="spooler-details-dt">Pull request</dt>
          <dd className="spooler-details-dd spooler-details-pr">
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "spooler-details-pr-link",
                `spooler-pr-${pullRequest.state}`,
              )}
              title={`${pullRequest.title} — open PR #${pullRequest.number}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenPr?.();
              }}
            >
              <Icon
                name={prIconName(pullRequest.state, pullRequest.attention)}
                aria-hidden="true"
              />
              <span>#{pullRequest.number} · {prLabel(pullRequest.state, pullRequest.attention)}</span>
            </a>
          </dd>
        </>
      ) : null}
      {replies && replies.hiddenTotal > 0 ? (
        <>
          <dt className="spooler-details-dt">Replies</dt>
          <dd className="spooler-details-dd">
            {replies.hiddenKids.map((kid) => kid.title).join(", ")}
            {replies.hiddenTotal > replies.hiddenKids.length
              ? ` +${replies.hiddenTotal - replies.hiddenKids.length}`
              : ""}
          </dd>
        </>
      ) : null}
      {context ? (
        <>
          <dt className="spooler-details-dt">Context</dt>
          <dd className="spooler-details-dd spooler-details-context">
            <div
              className="spooler-details-bar"
              role="img"
              aria-label={`${pct}% of ${formatTokens(maxTokens)} tokens used`}
            >
              {categories.length > 0
                ? categories.map((category) => (
                    <span
                      key={category.id}
                      className="spooler-details-bar-seg"
                      style={{
                        width: `${(category.tokens / maxTokens) * 100}%`,
                        background: CATEGORY_COLOR[category.kind],
                      }}
                      title={`${category.label}: ${formatTokens(category.tokens)}`}
                    />
                  ))
                : (
                    <span
                      className={cn(
                        "spooler-details-bar-seg",
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
                  className="spooler-details-bar-mark"
                  style={{ left: `${compactPct}%` }}
                  title={`Auto-compacts at ${formatTokens(context.autoCompactAtTokens ?? 0)}`}
                />
              ) : null}
            </div>
            <p className="spooler-details-context-note">
              {formatTokens(usedTokens)} of {maxTokens ? formatTokens(maxTokens) : "?"} used
              {context.estimated ? " · estimated" : null}
            </p>
          </dd>
        </>
      ) : null}
    </dl>
  );
}
