import { useEffect, useLayoutEffect, useRef } from "react";
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ThreadDetailFacts } from "./SpoolerThreadDetails";
import type {
  SpoolPullRequest,
} from "./usePullRequest";
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

export function SpoolerHoverCard({
  thread,
  anchor,
  pullRequest,
  facts,
  context,
  getContext,
  onOpenPr,
  onCopyBranch,
  copiedBranch = false,
  onMouseEnter,
  onMouseLeave,
}: {
  thread: PluginSidebarThread;
  anchor: { top: number; bottom: number; left: number; right: number };
  pullRequest: SpoolPullRequest | null;
  facts: HoverCardFacts;
  /** Usage the row's Details-peek cache already resolved (lazy, shared). */
  context: ContextUsage | null;
  /** First open of the peek triggers the row's one-shot fetch. */
  getContext?: () => void;
  onOpenPr?: () => void;
  onCopyBranch?: () => void;
  /** The row owns the copied flash, so both surfaces agree on it. */
  copiedBranch?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {

  const cardRef = useRef<HTMLDivElement>(null);

  // Context arrives lazily: the row's cache resolves once, either from this
  // peek or from the inline Details panel, whichever opens first.
  useEffect(() => {
    getContext?.();
  }, [getContext]);

  // Place the card against the row, then clamp it fully inside the viewport.
  // Runs before paint, so the card never shows at a wrong position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [anchor, context]);

  return (
    <div
      ref={cardRef}
      className="spooler-hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="dialog"
      aria-label={`${thread.displayTitle} details`}
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

      {/* ---------- Shared facts (same list the inline Details uses) ---------- */}
      <ThreadDetailFacts
        goal={
          (thread.titleFallback && thread.titleFallback !== thread.displayTitle)
            ? thread.titleFallback
            : null
        }
        statusLabel={facts.statusWord}
        model={facts.modelName}
        thinking={facts.thinking}
        providerName={facts.providerName}
        providerIcon={facts.providerIcon}
        hostName={facts.hostName}
        branch={thread.environment?.branchName ?? null}
        isWorktree={thread.environment?.isWorktree === true}
        pullRequest={pullRequest}
        sectionName={facts.sectionName}
        replies={
          facts.hiddenTotal > 0
            ? { hiddenTotal: facts.hiddenTotal, hiddenKids: facts.hiddenKids }
            : null
        }
        timeText={facts.timeText}
        context={context}
        copiedBranch={copiedBranch}
        onCopyBranch={onCopyBranch}
        onOpenPr={onOpenPr}
      />
    </div>
  );
}
