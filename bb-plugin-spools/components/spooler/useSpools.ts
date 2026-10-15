// useSpools — app-side spool state + mutations.
//
// Reads this plugin's per-thread metadata in bulk (1–200 ids per request)
// for every thread the sidebar surfaces and folds it into resolved spools
// (see ./spoolStore). Mutations plan metadata writes server-side via
// sdk.threads.updatePluginMetadata, then refetch — the sidebar thread list
// itself does NOT re-derive spool membership, so a refetch keeps the cache
// honest about changes made from other surfaces (agents, CLI).
//
// Spools only exist while members carry the metadata; an empty spool
// disappears by definition, so nothing prunes it.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveSpools,
  familyOf,
  newSpoolId,
  planLeadMigration,
  planMetadataWrites,
  type Spool,
  type SpoolMembership,
  type SpoolMetadataWrite,
} from "./spoolStore";

/** Minimal sdk shape used here (subset of PluginBrowserBbSdk["threads"]). */
export interface SpoolSdkClient {
  threads: {
    updatePluginMetadata(args: {
      threadId: string;
      pluginId: string;
      set?: Record<string, unknown>;
      remove?: string[];
    }): Promise<unknown>;
    experimental_listPluginMetadata(args: {
      threadIds: readonly string[];
      pluginId: string;
    }): Promise<{ threads: readonly { threadId: string; metadata: Record<string, unknown> }[] }>;
  };
}

export interface UseSpoolsResult {
  status: "loading" | "ready";
  spools: readonly Spool[];
  membershipFor(threadId: string): SpoolMembership | null;
  spoolFor(threadId: string): Spool | null;
  /** Bump: family members join the new spool with their own metadata. */
  createSpoolFromThread(
    threadId: string,
    args?: { extraMemberIds?: readonly string[]; customTitle?: string | null },
  ): Promise<void>;
  /** Throw thread (+ family) onto a spool; breaks it out of any other. */
  throwOntoSpool(spoolId: string, threadId: string): Promise<void>;
  /** Drop one thread (+ family) from its spool, migrating lead/title. */
  releaseThread(threadId: string): Promise<void>;
  renameSpool(spoolId: string, title: string): Promise<void>;
  /** Free every member — destructive: the spool stops existing. */
  unspool(spoolId: string): Promise<void>;
  /** Pull fresh metadata without a mutation (e.g. realtime recovery). */
  refresh(): void;
}

const FETCH_CHUNK = 200;

export function useSpools(args: {
  threads: readonly PluginSidebarThread[];
  pluginId: string;
  sdk: SpoolSdkClient;
}): UseSpoolsResult {
  const { sdk, pluginId } = args;
  const [rows, setRows] = useState<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  // Only the id set matters for reads — thread objects update constantly,
  // membership does not.
  const idSignature = useMemo(
    () => args.threads.map((thread) => thread.id).sort().join("\u0000"),
    [args.threads],
  );

  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    if (!pluginId) return;
    const ids = idSignature.split("\u0000").filter(Boolean);
    if (ids.length === 0) {
      setRows(new Map());
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const chunks: Map<string, Record<string, unknown>> = new Map();
        for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
          const response = await sdk.threads.experimental_listPluginMetadata({
            pluginId,
            threadIds: ids.slice(i, i + FETCH_CHUNK),
            signal: controller.signal,
          } as never);
          for (const row of response.threads) chunks.set(row.threadId, row.metadata ?? {});
        }
        if (controller.signal.aborted) return;
        setRows(chunks);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[spools] metadata fetch failed", error);
        setStatus("ready");
      }
    })();
    return () => controller.abort();
  }, [idSignature, version, pluginId, sdk]);

  // Membership cache state over time. Keep the current threads in a ref for
  // mutation planning (family walking needs the whole tree).
  const threadsRef = useRef(args.threads);
  threadsRef.current = args.threads;

  const derived = useMemo(
    () => deriveSpools({ threads: args.threads, metadataByThreadId: rows }),
    [args.threads, rows],
  );
  const { spools, membershipByThreadId } = derived;

  const spoolById = useMemo(() => new Map(spools.map((spool) => [spool.id, spool])), [spools]);

  const write = useCallback(
    async (writes: readonly SpoolMetadataWrite[]) => {
      if (writes.length === 0) return;
      const results = await Promise.allSettled(
        writes.map((write) =>
          sdk.threads.updatePluginMetadata({
            threadId: write.threadId,
            pluginId,
            set: write.set,
            remove: write.remove,
          } as never),
        ),
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn("[spools] metadata writes failed", failures.length, "of", writes.length);
      }
      refresh();
    },
    [sdk, pluginId, refresh],
  );

  /** parentThreadId → child ids from the freshest thread list. */
  const childrenOf = useCallback(() => {
    const map = new Map<string, string[]>();
    for (const thread of threadsRef.current) {
      const parent = thread.parentThreadId;
      if (!parent) continue;
      const kids = map.get(parent) ?? [];
      kids.push(thread.id);
      map.set(parent, kids);
    }
    return map;
  }, []);

  const membershipFor = useCallback(
    (threadId: string) => membershipByThreadId.get(threadId) ?? null,
    [membershipByThreadId],
  );
  const spoolFor = useCallback(
    (threadId: string) => {
      const membership = membershipByThreadId.get(threadId);
      return membership ? spoolById.get(membership.id) ?? null : null;
    },
    [membershipByThreadId, spoolById],
  );

  const createSpoolFromThread = useCallback<UseSpoolsResult["createSpoolFromThread"]>(
    async (threadId, extra) => {
      const family = familyOf({ threadId, childrenOf: childrenOf() });
      const memberIds = [...family, ...(extra?.extraMemberIds ?? [])];
      await write(
        planMetadataWrites(
          {
            kind: "create",
            spoolId: newSpoolId(),
            memberIds,
            leadId: threadId,
            customTitle: extra?.customTitle ?? null,
            joinedAt: Date.now(),
          },
          membershipByThreadId,
        ),
      );
    },
    [childrenOf, membershipByThreadId, write],
  );

  const throwOntoSpool = useCallback<UseSpoolsResult["throwOntoSpool"]>(
    async (spoolId, threadId) => {
      const family = familyOf({ threadId, childrenOf: childrenOf() });
      // Spools never nest: the member patch below rewrites the whole spool
      // key-set (spool/spoolJoined/spoolLead) and clears any stale spoolTitle
      // from a previous spool, so no separate break-out write is needed.
      await write(
        planMetadataWrites(
          { kind: "add", spoolId, memberIds: family, joinedAt: Date.now() },
          membershipByThreadId,
        ),
      );
    },
    [childrenOf, membershipByThreadId, write],
  );

  const releaseThread = useCallback<UseSpoolsResult["releaseThread"]>(
    async (threadId) => {
      const membership = membershipByThreadId.get(threadId);
      if (!membership) return;
      const spool = spoolById.get(membership.id);
      const remaining = (spool?.members ?? []).filter((id) => id !== threadId);
      const leavingLead = spool?.leadThreadId === threadId;
      const writes = planMetadataWrites(
        { kind: "breakOut", threadIds: familyOf({ threadId, childrenOf: childrenOf() }) },
        membershipByThreadId,
      );
      if (leavingLead && spool) {
        writes.push(
          ...planLeadMigration({
            spoolId: membership.id,
            memberIds: remaining,
            leavingLeadId: threadId,
            oldLeadCustomTitle: spool.customTitle,
            joinedAt: Date.now(),
          }),
        );
      }
      await write(writes);
    },
    [childrenOf, membershipByThreadId, spoolById, write],
  );

  const renameSpool = useCallback<UseSpoolsResult["renameSpool"]>(
    async (spoolId, title) => {
      const spool = spoolById.get(spoolId);
      if (!spool?.leadThreadId) return;
      await write(
        planMetadataWrites(
          { kind: "rename", memberIds: spool.members, leadId: spool.leadThreadId, customTitle: title },
          membershipByThreadId,
        ),
      );
    },
    [spoolById, membershipByThreadId, write],
  );

  const unspool = useCallback<UseSpoolsResult["unspool"]>(
    async (spoolId) => {
      const spool = spoolById.get(spoolId);
      if (!spool) return;
      await write(
        planMetadataWrites(
          { kind: "unspool", spoolId, memberIds: spool.members },
          membershipByThreadId,
        ),
      );
    },
    [spoolById, membershipByThreadId, write],
  );

  return {
    status,
    spools,
    membershipFor,
    spoolFor,
    createSpoolFromThread,
    throwOntoSpool,
    releaseThread,
    renameSpool,
    unspool,
    refresh,
  };
}
