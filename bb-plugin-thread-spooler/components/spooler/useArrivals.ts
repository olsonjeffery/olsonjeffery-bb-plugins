import { useEffect, useRef, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** Indicators that mean live work: flipping from one of these to
 * unread-success is a completion worth celebrating. */
const LIVE_INDICATORS: ReadonlySet<string> = new Set([
  "runtime",
  "background-agent",
  "background-command",
  "workflow",
  "goal",
  "plan-mode",
  "working-draft",
]);

const CELEBRATE_MS = 1500;

/**
 * Thread ids that just finished, for the one-time check pop.
 *
 * Transitions are diffed against the previous snapshot rather than read from
 * the current one, so a reload never replays celebrations for threads that
 * finished long ago.
 */
export function useArrivals(
  threads: readonly PluginSidebarThread[],
): ReadonlySet<string> {
  const previous = useRef<Map<string, string> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Snapshot updates must not cancel expiries; only unmount disposes them all.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const current = new Map(
      threads.map((thread) => [thread.id, thread.indicator]),
    );
    if (previous.current === null) {
      previous.current = current;
      return;
    }
    const before = previous.current;
    previous.current = current;
    const fresh = threads
      .filter(
        (thread) =>
          thread.indicator === "unread-success" &&
          LIVE_INDICATORS.has(before.get(thread.id) ?? ""),
      )
      .map((thread) => thread.id);
    if (fresh.length === 0) return;

    setCelebrating((ids) => new Set([...ids, ...fresh]));
    for (const id of fresh) {
      clearTimeout(timers.current.get(id));
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setCelebrating((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
      }, CELEBRATE_MS);
      timers.current.set(id, timer);
    }
  }, [threads]);

  return celebrating;
}
