import {
  experimental_useThreadActions,
  useBbNavigate,
  useSdk,
  type PluginSidebarThread,
  type PluginThreadActionEntry,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo } from "react";

const noop = (): void => undefined;

/**
 * The action surface the SDK 0.5 `experimental_useSidebarThreadActions()` hook
 * exposed, kept stable across the 0.6.37 migration. Two callers produce it:
 * `useThreadRowActions` binds one thread (using it swallows nothing and keeps
 * the row call sites unchanged), and the list builds a list-wide variant with
 * plain SDK/navigate calls.
 */
export interface SpoolerThreadActions {
  /** Open a thread; `{split: true}` applies bb's split placement rules. */
  open(threadId: string, options?: { split?: boolean }): void;
  /** Navigate to the new-thread screen. */
  openNewThread(options?: { projectId?: string; focusPrompt?: boolean }): void;
  /**
   * Archive (or unarchive, when the thread is already archived). Resolves
   * when the host settles the archive; fire-and-forget at the call sites.
   */
  archive(threadId: string): Promise<void>;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  /** The thread's desired read state: mark read when `read`, else unread. */
  setRead(threadId: string, read: boolean): Promise<void>;
  /** Ask bb to delete the thread: the core entry opens bb's own confirm. */
  requestDelete(threadId: string): Promise<void>;
  /** Commit a rename. bb has no plugin-facing rename run — the plugin owns
   * the editable title, so this writes through `useSdk().threads.update`. */
  rename(threadId: string, title: string): Promise<void>;
}

/**
 * The thread a thread action is evaluated for (0.6.37's
 * `PluginThreadActionTarget`): copied from the sidebar row, trimming the
 * display-only environment fields down to the reuse id + checkout path the
 * core actions read. `environment` is null when the row carries no
 * environment id yet.
 */
export function toActionTarget(
  thread: PluginSidebarThread,
): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      thread.environment && thread.environment.id
        ? { id: thread.environment.id, path: thread.environment.path }
        : null,
  };
}

/** bb's own action entries arrive under the `bb--core/<id>` owner key. */
function coreActionRun(
  entries: readonly PluginThreadActionEntry[],
  id: string,
): (() => Promise<void>) | null {
  return entries.find((entry) => entry.key === `bb--core/${id}`)?.action.run ??
    null;
}

/** The bound core runs of one thread, exposed by its row to list dispatch. */
export interface BoundThreadActions {
  archive: () => Promise<void>;
  requestDelete: () => Promise<void>;
}

/**
 * Per-row bindings for one thread. Call this once per row (you cannot call a
 * per-thread hook for a thread you do not render): it binds the host's own
 * actions — archive carries bb's pane cleanup and route repair, and delete
 * opens bb's confirmation which counts child threads.
 *
 * `requestRename` is deliberately omitted: the row owns its rename editor
 * through `onCommitRename`, and `rename` commits via `useSdk()` directly.
 */
export function useThreadRowActions(
  thread: PluginSidebarThread,
): SpoolerThreadActions {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const entries = experimental_useThreadActions(toActionTarget(thread));

  return useMemo(() => {
    const archiveRun = coreActionRun(entries, "archive");
    const deleteRun = coreActionRun(entries, "delete");
    return {
      open(threadId: string, options?: { split?: boolean }): void {
        navigate.toThread(threadId, options);
      },
      openNewThread(options?: { projectId?: string; focusPrompt?: boolean }): void {
        navigate.toCompose({ focusPrompt: true, ...options });
      },
      archive(threadId: string): Promise<void> {
        // The core run swaps archive ↔ unarchive on its own; the plain
        // mutations are the fallback when the host has no entry registered.
        return archiveRun
          ? archiveRun()
          : thread.isArchived
            ? sdk.threads.unarchive({ threadId }).then(noop)
            : sdk.threads.archive({ threadId }).then(noop);
      },
      setPinned(threadId: string, pinned: boolean): Promise<void> {
        return pinned
          ? sdk.threads.pin({ threadId }).then(noop)
          : sdk.threads.unpin({ threadId }).then(noop);
      },
      setRead(threadId: string, read: boolean): Promise<void> {
        return read
          ? sdk.threads.markRead({ threadId }).then(noop)
          : sdk.threads.markUnread({ threadId }).then(noop);
      },
      requestDelete(threadId: string): Promise<void> {
        return deleteRun
          ? deleteRun()
          : sdk.threads
            .delete({ threadId, childThreadsConfirmed: false })
            .then(noop);
      },
      rename(threadId: string, title: string): Promise<void> {
        return sdk.threads.update({ threadId, title }).then(() => undefined);
      },
    };
  }, [entries, thread, sdk, navigate]);
}

/** Mutable exchange the list uses to reach one row's bound core runs. */
export type ThreadActionRegistry = Map<string, BoundThreadActions>;

/**
 * Mounts beside the list's row context menu and publishes the open thread's
 * bound core runs into the shared registry, so requests made from the menu
 * (delete, archive/unarchive) run the same bindings the rows run — delete
 * opens bb's own confirmation with child counts — instead of raw mutations.
 *
 * Only render it while `thread` is non-null (the hook is per-thread).
 */
export function ThreadActionBridge({
  thread,
  registry,
}: {
  thread: PluginSidebarThread;
  registry: { current: ThreadActionRegistry };
}): null {
  const actions = useThreadRowActions(thread);
  useEffect(() => {
    const bound: BoundThreadActions = {
      archive: () => Promise.resolve().then(() => actions.archive(thread.id)),
      requestDelete: () =>
        Promise.resolve().then(() => actions.requestDelete(thread.id)),
    };
    const map = registry.current;
    map.set(thread.id, bound);
    return () => {
      if (map.get(thread.id) === bound) map.delete(thread.id);
    };
  }, [actions, thread, registry]);
  return null;
}
