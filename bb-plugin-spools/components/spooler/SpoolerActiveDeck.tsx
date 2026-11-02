// The fixed Active deck: a hardcoded top-bar section (sibling of the Inbox
// pseudo-section) that shows one duplicate card per running thread while the
// original row stays in its own section/spool. The list renders it inside a
// `spooler-active-station`: bar AND cards pin together as the list's overlay
// for the whole scroll (the ordinary group headers' sticky top is offset by
// the station's measured height), so work in flight stays glanceable
// wherever you've scrolled. The bar folds like every other group: chevron
// at the far right, down when expanded, right when collapsed.
import { Fragment } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Fold } from "./Fold";

/** Where the original row lives: the spool card's title when the thread is
 *  spooled, else its section's name, else the unfiled Inbox bucket. */
export interface ActiveCardOrigin {
  label: string;
  isSpool: boolean;
}

export type ActiveOriginOf = (thread: PluginSidebarThread) => ActiveCardOrigin;

/** Per-card attention priority matches the folded-family grammar: failed >
 *  needs-you > running — the duplicate reads what its own row shows. */
function cardIsFailed(thread: PluginSidebarThread): boolean {
  return (
    thread.indicator === "unread-error" || thread.indicator === "queued-failed"
  );
}

function CardStatus({ thread }: { thread: PluginSidebarThread }) {
  if (cardIsFailed(thread)) {
    return <span aria-hidden="true" className="spooler-dot spooler-dot-error" />;
  }
  if (thread.indicator === "waiting-for-input") {
    return (
      <span
        aria-hidden="true"
        className="spooler-dot spooler-dot-attention spooler-dot-pulse"
      />
    );
  }
  return (
    <span aria-hidden="true" className="spooler-spinner spooler-tone-running">
      <Icon name="Loading" />
    </span>
  );
}

export interface SpoolerActiveDeckProps {
  /** The deck's duplicate cards (the group's roots, host order). */
  threads: PluginSidebarThread[];
  /** Where each thread's ORIGINAL row lives, for the jump-home chip. */
  originOf: ActiveOriginOf;
  unread: number;
  failed: number;
  needsUser: number;
  /** Fold state (persisted in the list's group-collapse set). */
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (threadId: string) => void;
}

/** Bar button + fold of duplicate cards, inside the list's pinned station.
 *  The count rides the section pip grammar: a numeral overlaid by a running
 *  spinner — failed/needs-you members turn the overlay into its dot. */
export function SpoolerActiveDeck({
  threads,
  originOf,
  unread,
  failed,
  needsUser,
  collapsed,
  onToggle,
  onOpen,
}: SpoolerActiveDeckProps) {
  return (
    <Fragment>
      <button
        type="button"
        className="spooler-active-bar"
        aria-expanded={!collapsed}
        aria-controls="spooler-active-cards"
        aria-label={
          `Active, ${threads.length} running thread${threads.length === 1 ? "" : "s"}`
        }
        title={
          failed > 0
            ? `${failed} failed thread${failed === 1 ? "" : "s"}`
            : needsUser > 0
              ? `${needsUser} thread${needsUser === 1 ? "" : "s"} waiting for input`
              : `${threads.length} running thread${threads.length === 1 ? "" : "s"}`
        }
        onClick={onToggle}
      >
        <span className="spooler-active-bar-rail" aria-hidden="true">
          <Icon name="Zap" className="spooler-active-bar-rail-glyph" />
        </span>
        <span className="spooler-group-label">Active</span>
        <span className="spooler-group-meta">
          {unread > 0 ? (
            <span className="spooler-group-unread" aria-hidden="true">
              <span className="spooler-unread" />
              {unread}
            </span>
          ) : null}
          <span className="spooler-group-count spooler-group-count-pip">
            <span
              aria-hidden="true"
              className="spooler-group-status spooler-spinner spooler-tone-running"
            >
              {failed > 0 ? (
                <span className="spooler-dot spooler-dot-error" />
              ) : needsUser > 0 ? (
                <span className="spooler-dot spooler-dot-attention spooler-dot-pulse" />
              ) : (
                <Icon name="Loading" />
              )}
            </span>
            <span className="spooler-pip-numeral">{threads.length}</span>
          </span>
        </span>
        <Icon
          name={collapsed ? "ChevronRight" : "ChevronDown"}
          aria-hidden="true"
          className="spooler-active-bar-chevron"
        />
      </button>
      <Fold collapsed={collapsed} role="list" label="Running threads">
        {() => (
          <div id="spooler-active-cards" className="spooler-active-cards">
            {threads.map((thread) => {
              const origin = originOf(thread);
              return (
                <button
                  type="button"
                  key={thread.id}
                  className="spooler-active-card"
                  title={`${origin ? `${origin.label} — ` : ""}${thread.displayTitle} (running)`}
                  aria-label={
                    `${thread.displayTitle}, running${origin ? ` in ${origin.label}` : ""}`
                  }
                  onClick={() => onOpen(thread.id)}
                >
                  <CardStatus thread={thread} />
                  <span className="spooler-active-card-title">
                    {thread.displayTitle}
                  </span>
                  {origin ? (
                    <span
                      className={
                        "spooler-active-card-origin" +
                        (origin.isSpool ? " spooler-active-card-origin-spool" : "")
                      }
                    >
                      {origin.isSpool ? (
                        <span aria-hidden="true" className="spooler-spool-emoji">🧵</span>
                      ) : null}
                      <span className="spooler-active-card-origin-label">
                        {origin.label}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Fold>
    </Fragment>
  );
}
