import { useCallback, useMemo } from "react";
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  TIME_GROUP_LABELS,
  TIME_GROUP_ORDER,
  activityTime,
  isLiveThread,
  isRunningThread,
  timeGroupFor,
} from "./time";

/** A rendered group of threads: a time bucket, a project, or a section. */
export interface ThreadGroup {
  id: string;
  label: string;
  icon: string;
  /** Root threads (children render nested beneath via `renderSubtree`). */
  roots: PluginSidebarThread[];
  /** Shown members including nested descendants. */
  total: number;
  /** Shown unread members including nested descendants. */
  unread: number;
  /** Number of executing threads in group, including background work. */
  live: number;
  /** Number of threads waiting for input in group. */
  needsUser: number;
  /** Number of failed threads in group. */
  failed: number;
  /** Set for project groups so rows can hide a redundant project chip. */
  projectId: string | null;
  /** Set for section groups: target of drag-to-organize moves. */
  sectionId: string | null;
}

interface SubtreeCounts {
  total: number;
  unread: number;
  live: number;
  needsUser: number;
  failed: number;
  kids: { id: string; title: string; dot: string | null }[];
}

function comparePinned(a: PluginSidebarThread, b: PluginSidebarThread): number {
  if (a.pinSortKey !== null || b.pinSortKey !== null) {
    if (a.pinSortKey === null) return 1;
    if (b.pinSortKey === null) return -1;
    if (a.pinSortKey !== b.pinSortKey) {
      return a.pinSortKey < b.pinSortKey ? -1 : 1;
    }
  }
  return (b.pinnedAt ?? b.updatedAt) - (a.pinnedAt ?? a.updatedAt);
}

export const UNFILED_GROUP_ID = "section:__unfiled__";

/**
 * Everything the list shows, derived from the host's thread array: which rows
 * are visible (query + status, with ancestor context), how they nest, and how
 * they group. Pure derivation, so it can be tested without rendering.
 */
export function useThreadGroups(args: {
  threads: readonly PluginSidebarThread[];
  query: string;
  statusFilter: "all" | "live" | "waiting" | "unread" | "pinned";
  grouping: "time" | "project" | "section";
  projectOrder: readonly string[];
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  now: number;
}) {
  const {
    threads,
    query,
    statusFilter,
    grouping,
    projectOrder,
    projects,
    sections,
    now,
  } = args;

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const sectionById = useMemo(
    () => new Map(sections.map((section) => [section.id, section])),
    [sections],
  );
  const projectNameFor = useCallback(
    (thread: PluginSidebarThread) =>
      projectById.get(thread.projectId)?.name ?? "Unknown project",
    [projectById],
  );

  // Candidate rows: the host's lifecycle set minus hidden helpers.
  const allRows = useMemo(
    () => threads.filter((thread) => !thread.isHidden),
    [threads],
  );
  const rowById = useMemo(
    () => new Map(allRows.map((thread) => [thread.id, thread])),
    [allRows],
  );
  // Effective parent links: only parents that are themselves rows, with any
  // cycle broken at the first member met. Without that, threads whose parents
  // point at each other would have no root and vanish from every grouping.
  const parentOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const thread of allRows) {
      if (thread.parentThreadId && rowById.has(thread.parentThreadId)) {
        map.set(thread.id, thread.parentThreadId);
      }
    }
    for (const thread of allRows) {
      const seen = new Set<string>([thread.id]);
      let cursor = map.get(thread.id);
      while (cursor !== undefined) {
        if (cursor === thread.id) {
          map.delete(thread.id);
          break;
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        cursor = map.get(cursor);
      }
    }
    return map;
  }, [allRows, rowById]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, PluginSidebarThread[]>();
    for (const thread of allRows) {
      const parentId = parentOf.get(thread.id);
      if (parentId === undefined) continue;
      const list = map.get(parentId);
      if (list) list.push(thread);
      else map.set(parentId, [thread]);
    }
    return map;
  }, [allRows, parentOf]);

  const statusCounts = useMemo(() => {
    let live = 0;
    let waiting = 0;
    let unread = 0;
    for (const thread of allRows) {
      if (isLiveThread(thread)) live += 1;
      if (
        thread.indicator === "waiting-for-input" ||
        thread.indicator === "queued-waiting"
      ) {
        waiting += 1;
      }
      if (thread.isUnread) unread += 1;
    }
    return { live, waiting, unread };
  }, [allRows]);

  // Query and status matching is bottom-up: a thread shows when it matches
  // or any descendant does, so matching children keep their ancestor context.
  const shownIds = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchesStatus = (thread: PluginSidebarThread) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "live") return isLiveThread(thread);
      if (statusFilter === "waiting") {
        return (
          thread.indicator === "waiting-for-input" ||
          thread.indicator === "queued-waiting"
        );
      }
      if (statusFilter === "unread") return thread.isUnread;
      if (statusFilter === "pinned") return thread.isPinned;
      return true;
    };
    if (tokens.length === 0 && statusFilter === "all") {
      return new Set(allRows.map((t) => t.id));
    }
    const matchesText = (thread: PluginSidebarThread) => {
      if (tokens.length === 0) return true;
      // Parenthesised deliberately: `.toLowerCase()` on the last template
      // literal alone left every earlier fragment case-sensitive.
      const haystack = [
        thread.displayTitle,
        projectNameFor(thread),
        thread.sectionId ? (sectionById.get(thread.sectionId)?.name ?? "") : "",
        thread.environment?.branchName ?? "",
        thread.environment?.name ?? "",
        thread.host?.name ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    };
    const matchesSelf = (thread: PluginSidebarThread) =>
      matchesText(thread) && matchesStatus(thread);
    const shown = new Set<string>();
    const visit = (thread: PluginSidebarThread, depth: number): boolean => {
      const self = matchesSelf(thread);
      if (depth > 25) {
        if (self) shown.add(thread.id);
        return self;
      }
      let keep = self;
      for (const child of childrenOf.get(thread.id) ?? []) {
        if (visit(child, depth + 1)) keep = true;
      }
      if (keep) shown.add(thread.id);
      return keep;
    };
    for (const thread of allRows) {
      if (!parentOf.has(thread.id)) visit(thread, 0);
    }
    return shown;
  }, [allRows, parentOf, childrenOf, query, statusFilter, projectNameFor, sectionById]);

  // Roots: no visible parent (orphans whose parent is hidden or filtered
  // out promote to roots). Children always nest under theirs.
  const roots = useMemo(
    () =>
      allRows.filter(
        (thread) => !parentOf.has(thread.id) && shownIds.has(thread.id),
      ),
    [allRows, parentOf, shownIds],
  );

  const shownChildren = useMemo(() => {
    const map = new Map<string, PluginSidebarThread[]>();
    for (const [parentId, kids] of childrenOf) {
      const shown = kids
        .filter((kid) => shownIds.has(kid.id))
        .sort((a, b) => activityTime(b, now) - activityTime(a, now));
      if (shown.length > 0) map.set(parentId, shown);
    }
    return map;
  }, [childrenOf, shownIds, now]);

  // Child activity bubbles: a root groups/sorts by the freshest activity
  // in its shown subtree, so an active child floats its parent.
  const subtreeActivity = useMemo(() => {
    const cache = new Map<string, number>();
    return (root: PluginSidebarThread): number => {
      const cached = cache.get(root.id);
      if (cached !== undefined) return cached;
      let peak = activityTime(root, now);
      const walk = (id: string, depth: number) => {
        if (depth > 25) return;
        for (const child of shownChildren.get(id) ?? []) {
          peak = Math.max(peak, activityTime(child, now));
          walk(child.id, depth + 1);
        }
      };
      walk(root.id, 0);
      cache.set(root.id, peak);
      return peak;
    };
  }, [shownChildren, now]);

  // Cache each family's summary for this derived tree: sorting, headers and
  // repeated row renders share the same work. A filter/snapshot change resets it.
  const countSubtree = useMemo(() => {
    const cache = new Map<string, SubtreeCounts>();
    return (root: PluginSidebarThread): SubtreeCounts => {
      const cached = cache.get(root.id);
      if (cached) return cached;
      let total = 1;
      let unread = root.isUnread ? 1 : 0;
      let live = Number(isRunningThread(root));
      let needsUser = Number(root.indicator === "waiting-for-input");
      let failed = Number(
        root.indicator === "unread-error" ||
        root.indicator === "queued-failed",
      );
      const kids: { id: string; title: string; dot: string | null }[] = [];
      const walk = (id: string, depth: number) => {
        if (depth > 25) return;
        for (const child of shownChildren.get(id) ?? []) {
          total += 1;
          if (child.isUnread) unread += 1;
          const childLive = isRunningThread(child);
          if (childLive) live += 1;
          const childNeeds = child.indicator === "waiting-for-input";
          if (childNeeds) needsUser += 1;
          const childFailed =
            child.indicator === "unread-error" ||
            child.indicator === "queued-failed";
          if (childFailed) failed += 1;
          if (kids.length < 5) {
            kids.push({
              id: child.id,
              title: child.displayTitle,
              dot: childFailed
                ? "spooler-dot-error"
                : childNeeds
                  ? "spooler-dot-attention"
                  : childLive
                    ? "spooler-dot-running spooler-dot-pulse"
                    : child.isUnread
                      ? "spooler-unread"
                      : null,
            });
          }
          walk(child.id, depth + 1);
        }
      };
      walk(root.id, 0);
      const counts = { total, unread, live, needsUser, failed, kids };
      cache.set(root.id, counts);
      return counts;
    };
  }, [shownChildren]);

  const assembleGroup = useCallback(
    (
      id: string,
      label: string,
      icon: string,
      members: PluginSidebarThread[],
      projectId: string | null = null,
      sectionId: string | null = null,
    ): ThreadGroup => {
      let total = 0;
      let unread = 0;
      let live = 0;
      let needsUser = 0;
      let failed = 0;
      for (const root of members) {
        const counts = countSubtree(root);
        total += counts.total;
        unread += counts.unread;
        live += counts.live;
        needsUser += counts.needsUser;
        failed += counts.failed;
      }
      return {
        id,
        label,
        icon,
        roots: members,
        total,
        unread,
        live,
        needsUser,
        failed,
        projectId,
        sectionId,
      };
    },
    [countSubtree],
  );

  const pinnedGroup = useMemo<ThreadGroup | null>(() => {
    const pinnedRoots = roots.filter((root) => root.isPinned).sort(comparePinned);
    if (pinnedRoots.length === 0) return null;
    return assembleGroup("pinned", "Pinned", "Pin", pinnedRoots);
  }, [roots, assembleGroup]);

  const groups = useMemo<ThreadGroup[]>(() => {
    const rest = roots
      .filter((root) => !root.isPinned)
      .sort((a, b) => subtreeActivity(b) - subtreeActivity(a));
    if (grouping === "project") {
      const byProject = new Map<string, PluginSidebarThread[]>();
      for (const root of rest) {
        const list = byProject.get(root.projectId);
        if (list) list.push(root);
        else byProject.set(root.projectId, [root]);
      }
      const rank = new Map(projectOrder.map((id, index) => [id, index]));
      return [...byProject.entries()]
        .map(([projectId, list]) => ({
          group: assembleGroup(
            `project:${projectId}`,
            projectById.get(projectId)?.name ?? "Unknown project",
            "Folder",
            list,
            projectId,
          ),
          projectId,
        }))
        .sort((a, b) => {
          const rankA = rank.get(a.projectId) ?? Number.MAX_SAFE_INTEGER;
          const rankB = rank.get(b.projectId) ?? Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) return rankA - rankB;
          return (
            subtreeActivity(b.group.roots[0]) -
            subtreeActivity(a.group.roots[0])
          );
        })
        .map((entry) => entry.group);
    }
    if (grouping === "section") {
      // Server section order first, then an Unfiled bucket; empty sections
      // still render so there is always somewhere to drop a thread.
      const bySection = new Map<string, PluginSidebarThread[]>();
      const unfiled: PluginSidebarThread[] = [];
      for (const root of rest) {
        if (root.sectionId && sectionById.has(root.sectionId)) {
          const list = bySection.get(root.sectionId);
          if (list) list.push(root);
          else bySection.set(root.sectionId, [root]);
        } else {
          unfiled.push(root);
        }
      }
      const ordered: ThreadGroup[] = [];
      for (const section of sections) {
        ordered.push(
          assembleGroup(
            `section:${section.id}`,
            section.name,
            "SectionMove",
            bySection.get(section.id) ?? [],
            null,
            section.id,
          ),
        );
        bySection.delete(section.id);
      }
      // Sections created since the last refresh still appear.
      for (const [sectionId, list] of bySection) {
        ordered.push(
          assembleGroup(
            `section:${sectionId}`,
            sectionById.get(sectionId)?.name ?? "Section",
            "SectionMove",
            list,
            null,
            sectionId,
          ),
        );
      }
      ordered.push(
        assembleGroup(
          UNFILED_GROUP_ID,
          "Unfiled",
          "FolderUnknown",
          unfiled,
          null,
          null,
        ),
      );
      return ordered;
    }
    const buckets = new Map<string, PluginSidebarThread[]>();
    for (const root of rest) {
      const key = timeGroupFor(subtreeActivity(root), now);
      const list = buckets.get(key);
      if (list) list.push(root);
      else buckets.set(key, [root]);
    }
    return TIME_GROUP_ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map(
      (key) =>
        assembleGroup(
          `time:${key}`,
          TIME_GROUP_LABELS[key],
          "Clock",
          buckets.get(key) ?? [],
        ),
    );
  }, [
    roots,
    grouping,
    projectById,
    projectOrder,
    sections,
    sectionById,
    now,
    subtreeActivity,
    assembleGroup,
  ]);

  const shownTotal =
    (pinnedGroup?.total ?? 0) +
    groups.reduce((count, group) => count + group.total, 0);

  return {
    allRows,
    rowById,
    childrenOf,
    statusCounts,
    shownIds,
    roots,
    shownChildren,
    countSubtree,
    subtreeActivity,
    pinnedGroup,
    groups,
    shownTotal,
    projectNameFor,
    projectById,
    sectionById,
  };
}
