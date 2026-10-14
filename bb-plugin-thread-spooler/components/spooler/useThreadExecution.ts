import { useEffect, useState } from "react";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/**
 * Per-thread execution info (model + reasoning level) for the thread rows.
 *
 * The sidebar payload only carries `providerId`, so model/thinking comes
 * from `threads.defaultExecutionOptions` per rendered row, with a shared
 * module-level cache (stale-while-revalidate: cached values paint instantly
 * and refresh in the background). Model ids resolve to display names through
 * each provider's model catalog, fetched once per provider per window.
 */

export interface ThreadExecution {
  model: string;
  reasoningLevel: string;
}

const executionCache = new Map<string, ThreadExecution | null>();
const executionInflight = new Map<
  string,
  { version: string; promise: Promise<ThreadExecution | null> }
>();
/** Cache freshness includes activity, so a filtered-out run cannot stay fresh. */
const executionVersion = new Map<string, string>();
const catalogCache = new Map<string, Map<string, string> | null>();
const catalogInflight = new Map<string, Promise<Map<string, string> | null>>();

function cap<T>(map: Map<string, T>, limit = 2000): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

function fetchExecution(
  sdk: PluginBrowserBbSdk,
  threadId: string,
  version: string,
): Promise<ThreadExecution | null> {
  const existing = executionInflight.get(threadId);
  if (existing?.version === version) return existing.promise;
  const promise = sdk.threads
    .defaultExecutionOptions({ threadId })
    .then(
      (result): ThreadExecution | null =>
        result === null
          ? null
          : { model: result.model, reasoningLevel: result.reasoningLevel },
    )
    .catch((): ThreadExecution | null => null)
    .then((resolved) => {
      // A request from an earlier run must not overwrite the new run's cache.
      if (executionInflight.get(threadId)?.promise === promise) {
        executionCache.set(threadId, resolved);
        executionVersion.set(threadId, version);
        cap(executionCache);
        cap(executionVersion);
        executionInflight.delete(threadId);
      }
      return resolved;
    });
  executionInflight.set(threadId, { version, promise });
  return promise;
}

export function useThreadExecution(
  threadId: string,
  sdk: PluginBrowserBbSdk,
  epoch: number,
  enabled = true,
  latestAttentionAt = 0,
  isVisible = true,
): ThreadExecution | null | undefined {
  const version = `${epoch}:${latestAttentionAt}`;
  const [value, setValue] = useState<ThreadExecution | null | undefined>(() =>
    enabled && executionCache.has(threadId)
      ? (executionCache.get(threadId) ?? null)
      : undefined,
  );
  useEffect(() => {
    if (!enabled) {
      // Going idle ends this cache lifetime, even without a window-focus change.
      executionVersion.delete(threadId);
      executionInflight.delete(threadId);
      setValue(undefined);
      return;
    }
    // Folding suspends requests without ending the run's cache lifetime.
    // Changes while hidden are revalidated when the row is revealed.
    if (!isVisible) return;
    // Same activity and focus epoch (e.g. regrouping the same live run):
    // paint from cache without refetching.
    if (
      executionCache.has(threadId) &&
      executionVersion.get(threadId) === version
    ) {
      setValue(executionCache.get(threadId) ?? null);
      return;
    }
    let cancelled = false;
    void fetchExecution(sdk, threadId, version).then((resolved) => {
      if (cancelled) return;
      setValue(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, sdk, version, enabled, isVisible]);
  return enabled ? value : undefined;
}

function fetchCatalog(
  sdk: PluginBrowserBbSdk,
  providerId: string,
): Promise<Map<string, string> | null> {
  const existing = catalogInflight.get(providerId);
  if (existing) return existing;
  const promise = sdk
    .providers
    .models({ providerId })
    .then((result): Map<string, string> | null => {
      const names = new Map<string, string>();
      for (const entry of result.models ?? []) {
        names.set(entry.model, entry.displayName);
        names.set(entry.id, entry.displayName);
      }
      return names;
    })
    .catch((): Map<string, string> | null => null)
    .then((resolved) => {
      catalogCache.set(providerId, resolved);
      if (catalogInflight.get(providerId) === promise) {
        catalogInflight.delete(providerId);
      }
      return resolved;
    });
  catalogInflight.set(providerId, promise);
  return promise;
}

/** Display name for a model id, falling back to the id's last segment. */
export function useModelDisplayName(
  providerId: string,
  model: string | null,
  sdk: PluginBrowserBbSdk,
  isVisible = true,
): string | null {
  const [names, setNames] = useState<Map<string, string> | null | undefined>(
    () => catalogCache.get(providerId),
  );
  useEffect(() => {
    if (!model || !isVisible) return;
    if (catalogCache.has(providerId)) {
      setNames(catalogCache.get(providerId) ?? null);
      return;
    }
    let cancelled = false;
    void fetchCatalog(sdk, providerId).then((resolved) => {
      if (!cancelled) setNames(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, model, sdk, isVisible]);
  if (!model) return null;
  const hit = names?.get(model);
  if (hit) return hit;
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

export function formatReasoningLevel(level: string): string {
  if (level === "none") return "Off";
  return level.charAt(0).toUpperCase() + level.slice(1);
}
