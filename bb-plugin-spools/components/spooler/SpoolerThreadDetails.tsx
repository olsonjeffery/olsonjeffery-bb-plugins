// ThreadDetailFacts: the "definition list of facts" appended beneath a
// thread's header when it opens. Pure presentation: interactive bits (branch
// copy, PR open) arrive as callbacks. Provider, section AND status are
// absent by design — the row's own header (provider icon, provider name,
// status word·pill, time) carries them, so the panel never duplicates its
// host. Model/effort is always here: defaults resolve for any thread.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { prLabel, prIconName } from "./SpoolerThreadRow";
import type {
  SpoolPullRequest,
} from "./usePullRequest";
import type { TagInfo } from "./threadTags";
import { ThreadTagBadge } from "./ThreadTagBadge";

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
  model: string | null;
  thinking: string | null;
  /** Away-from-home host only (the list filters it before us). */
  hostName: string | null;
  branch: string | null;
  isWorktree: boolean;
  /** The thread's one Thread Tags badge (bb-plugin-thread-tags), or null. */
  tag: TagInfo | null;
  /** Full relative activity time — the sub-head's short time is its
   *  tooltip on the desktop; touch has no tooltips, so the panel keeps it. */
  activity: string | null;
  pullRequest: SpoolPullRequest | null;
  replies: ThreadDetailReplyInfo | null;
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
  model,
  thinking,
  hostName,
  branch,
  isWorktree,
  tag,
  activity,
  pullRequest,
  replies,
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
  // Tone-category weight, in %: the overlay only renders when it actually
  // accounts for usage (a category snapshot that sums to zero can never
  // leave the bar empty — the base fill paints regardless).
  const categoryTotal = categories.reduce(
    (sum, category) => sum + (category.tokens / maxTokens) * 100,
    0,
  );

  return (
    <dl className="spooler-details-dl">
      {goal ? (
        <>
          <dt className="spooler-details-dt">Goal</dt>
          <dd className="spooler-details-dd spooler-details-goal">{goal}</dd>
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
      {tag ? (
        <>
          <dt className="spooler-details-dt">Tag</dt>
          <dd className="spooler-details-dd spooler-details-tag">
            <ThreadTagBadge tag={tag} small />
          </dd>
        </>
      ) : null}
      {activity ? (
        <>
          <dt className="spooler-details-dt">Activity</dt>
          <dd className="spooler-details-dd">{activity}</dd>
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
            {/* The bar is never empty: a base fill from used/max always
                paints (2px floor), and real tone categories overlay on top
                of it only when they account for the usage they claim. */}
            <div
              className="spooler-details-bar"
              role="img"
              aria-label={`${pct}% of ${formatTokens(maxTokens)} tokens used`}
            >
              {categories.length > 0 && categoryTotal > 0
                ? (
                    <>
                      {pct > categoryTotal + 1 ? (
                        <span
                          className="spooler-details-bar-seg spooler-token-normal"
                          style={{ width: `${pct - categoryTotal}%` }}
                        />
                      ) : null}
                      {categories.map((category) => (
                        <span
                          key={category.id}
                          className="spooler-details-bar-seg"
                          style={{
                            width: `${(category.tokens / maxTokens) * 100}%`,
                            background: CATEGORY_COLOR[category.kind],
                          }}
                          title={`${category.label}: ${formatTokens(category.tokens)}`}
                        />
                      ))}
                    </>
                  )
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
