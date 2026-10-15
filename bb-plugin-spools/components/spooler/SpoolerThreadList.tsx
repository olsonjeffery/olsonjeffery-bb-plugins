import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultKeyboardCoordinateGetter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  experimental_usePluginId,
  experimental_useProviders,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSdk,
  useSettings,
  type PluginSidebarSection,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  swipeActionFromSetting,
} from "@/lib/swipe";
import { preloadExtendedIcons } from "@/components/ui/icon";
import { SpoolerThreadRow } from "./SpoolerThreadRow";
import { activityTime, isRunningThread, timeAgo } from "./time";
import {
  GroupHeader,
  SortableGroupSection,
} from "./SpoolerGroupHeader";
import { SpoolerMenu, type SpoolerMenuItem } from "./SpoolerMenu";
import { UnspoolConfirmDialog } from "./UnspoolConfirmDialog";
import { useArrivals } from "./useArrivals";
import {
  useThreadGroups,
  SETTLED_GROUP_ID,
  type ThreadGroup,
} from "./useThreadGroups";
import {
  SECTION_COLOR_NONE,
  SECTION_COLOR_OPTIONS,
  colorSwatchFor,
  onSectionColorsChanged,
  readSectionColorMap,
  sectionColorOption,
  sectionColorVars,
  writeSectionColorMap,
  type SectionColorMap,
} from "./sectionColors";
import { useThemeIsDark } from "./useThemeIsDark";
import { SpoolerSmartViews } from "./SpoolerSmartViews";
import { SpoolerNewSection } from "./SpoolerNewSection";
import { SpoolCard } from "./SpoolCard";
import { PaletteOverlay } from "./PaletteOverlay";
import { onPaletteIntent, type PaletteIntent } from "./paletteBus";
import { useSpools } from "./useSpools";
import {
  ThreadActionBridge,
  type SpoolerThreadActions,
  type ThreadActionRegistry,
} from "./useThreadRowActions";

void preloadExtendedIcons().catch(() => undefined);

type LifecycleFilter = "active" | "archived" | "all";
type Grouping = "time" | "project" | "section";
export type StatusFilter = "all" | "live" | "waiting" | "unread" | "pinned";

/** Row drag affordance handed to a thread row's grip handle. */
export interface RowDragHandle {
  attributes: ReturnType<typeof useDraggable>["attributes"];
  listeners: ReturnType<typeof useDraggable>["listeners"];
  isDragging: boolean;
}
type DensityMode = "comfortable" | "compact";

const LIFECYCLE_KEY = "spooler-sidebar:lifecycles:v1";
const GROUPING_KEY = "spooler-sidebar:grouping:v1";
const COLLAPSED_KEY = "spooler-sidebar:collapsed:v1";
const COLLAPSED_THREADS_KEY = "spooler-sidebar:collapsed-threads:v1";
const PROJECT_ORDER_KEY = "spooler-sidebar:project-order:v1";
const STATUS_FILTER_KEY = "spooler-sidebar:status-filter:v1";
const DENSITY_KEY = "spooler-sidebar:density:v1";
const LAST_DEFAULT_DENSITY_KEY = "spooler-sidebar:last-default-density:v1";
const LAST_TWO_LINE_TITLES_KEY = "spooler-sidebar:last-two-line-titles:v1";

const EMPTY_ID_SET: ReadonlySet<string> = new Set();


function readStored<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // Private browsing or unavailable storage: fall through to the default.
  }
  return fallback;
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore: the preference simply won't persist.
  }
}

/** Plugin settings, with the shipped defaults applied while they load. The two
 * that set row height fall back to the value this client last saw instead, so
 * a reload paints rows at their final size without holding the list back.
 * Swipe actions stay off until the settings arrive. */
function useSidebarSettings() {
  const { values } = useSettings();
  const flag = (key: string, fallback: boolean): boolean =>
    typeof values?.[key] === "boolean" ? (values[key] as boolean) : fallback;
  const [lastSeen] = useState(() => ({
    defaultDensity: readStored<DensityMode>(
      LAST_DEFAULT_DENSITY_KEY,
      "comfortable",
      ["comfortable", "compact"],
    ),
    wrapTitles: readStored(LAST_TWO_LINE_TITLES_KEY, "off", ["off", "on"]) === "on",
  }));
  const loaded = values !== undefined;
  const defaultDensity: DensityMode = loaded
    ? values.defaultDensity === "compact" ? "compact" : "comfortable"
    : lastSeen.defaultDensity;
  const wrapTitles = loaded ? flag("twoLineTitles", false) : lastSeen.wrapTitles;
  // Swipes act on threads, so they wait for the saved choice rather than
  // running on the defaults for someone who turned them off.
  const swipeOn = loaded && flag("swipeActions", true);
  useEffect(() => {
    if (!loaded) return;
    writeStored(LAST_DEFAULT_DENSITY_KEY, defaultDensity);
    writeStored(LAST_TWO_LINE_TITLES_KEY, wrapTitles ? "on" : "off");
  }, [loaded, defaultDensity, wrapTitles]);
  return {
    hoverCard: flag("hoverCard", true),
    celebrate: flag("celebrate", true),
    motion: flag("motion", true),
    loudUnread: flag("loudUnread", true),
    adaptiveCollapse: flag("adaptiveCollapse", true),
    defaultDensity,
    wrapTitles,
    swipeRight: swipeOn
      ? swipeActionFromSetting(values?.swipeRight, DEFAULT_SWIPE_RIGHT)
      : "none",
    swipeLeft: swipeOn
      ? swipeActionFromSetting(values?.swipeLeft, DEFAULT_SWIPE_LEFT)
      : "none",
  };
}

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Corrupt value: start fresh.
  }
  return [];
}

/** One line per outcome so a partly-failed bulk action never reads as success. */
function reportBulk(
  results: readonly PromiseSettledResult<unknown>[],
  success: (count: number) => string,
  failure: (count: number) => string,
): void {
  const failed = results.filter((result) => result.status === "rejected").length;
  const succeeded = results.length - failed;
  if (failed > 0) toast.error(failure(failed));
  if (succeeded > 0) toast.success(success(succeeded));
}

const noop = (): void => undefined;

const nThreads = (count: number) => `${count} thread${count === 1 ? "" : "s"}`;

/**
 * A section group that accepts a dragged thread or spool. Highlighting is
 * driven by dnd-kit's `isOver`, so the drop target is unmistakable before
 * release — for either drag kind. Exported for the drop-cue tests.
 */
export function DroppableSectionSection({
  group,
  draggingThreadId,
  draggingSpoolId,
  draggingSpoolSectionId,
  onDropThread,
  children,
}: {
  group: ThreadGroup;
  draggingThreadId: string | null;
  draggingSpoolId: string | null;
  /** Where the dragged spool currently sits (its lead thread's section),
   * matching what "Move all to section" considers current. */
  draggingSpoolSectionId: string | null;
  onDropThread: (threadId: string, sectionId: string | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: group.id,
    data: { sectionId: group.sectionId },
  });
  const hasThreadDrag = draggingThreadId != null;
  const hasSpoolDrag = draggingSpoolId != null;
  const hasDrag = hasThreadDrag || hasSpoolDrag;
  const dragged = hasThreadDrag
    ? (group.roots.find((root) => root.id === draggingThreadId) ?? null)
    : null;
  // No point offering a drag its own current section. A spool's members all
  // count as sitting where the lead sits (same rule as the ctx menu).
  const existingSectionId = hasSpoolDrag
    ? draggingSpoolSectionId
    : dragged != null
      ? (dragged.sectionId ?? null)
      : null;
  const alreadyHere = hasDrag && existingSectionId === group.sectionId;
  return (
    // A plain div: the wrapped group already renders the labelled <section>.
    <div
      ref={setNodeRef}
      className={cn(
        "spooler-group",
        "spooler-group-section",
        isOver && hasDrag && !alreadyHere && "spooler-group-drop-active",
        isOver && hasDrag && alreadyHere && "spooler-group-drop-same",
      )}
      onDrop={(event) => {
        if (!hasDrag) return;
        event.preventDefault();
        // A spool drag still resolves through the section DndContext's
        // onDragEnd (it must re-file every member, not just one thread).
        if (!hasThreadDrag) return;
        onDropThread(draggingThreadId, group.sectionId);
      }}
      onDragOver={(event) => {
        if (hasDrag) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

/** Wraps a row so its grip can start a drag onto a section header. */
/** Wraps a row so its grip can start a drag onto a section header. */
function DraggableThreadRow({
  threadId,
  dropData,
  dropCue,
  renderRow,
}: {
  threadId: string;
  /** Row droppable payload (section grouping only): null in other groupings. */
  dropData: { kind: "threaddrop"; threadId: string; sectionId: string | null } | null;
  /** In-drag positional feedback computed by the section onDragOver. */
  dropCue: "above" | "below" | "onto" | null;
  renderRow: (handle: RowDragHandle) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `thread:${threadId}`,
    data: { threadId },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `threaddrop:${threadId}`,
    data: dropData ?? undefined,
    disabled: !dropData,
  });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setDropRef(el);
      }}
      className={cn(
        "spooler-row-draggable",
        isDragging && "spooler-row-dragging",
        dropCue === "above" && "spooler-row-insert-above",
        dropCue === "below" && "spooler-row-insert-below",
        dropCue === "onto" && "spooler-row-drop-onto",
      )}
    >
      {renderRow({ attributes, listeners, isDragging })}
    </div>
  );
}

/** Outlasts the `.spooler-fold` collapse transition (280ms in app.css). */
const FOLD_UNMOUNT_MS = 320;

/**
 * A collapsible group or family body. Its rows stay mounted only while open
 * and through the closing animation, so a folded group costs nothing: no
 * rows, no per-row host subscriptions, no pull-request lookups. Opening
 * mounts them in the same commit the grid starts growing, so it animates.
 */
function Fold({
  collapsed,
  role,
  label,
  children,
}: {
  collapsed: boolean;
  role: "list" | "group";
  label: string;
  children: () => ReactNode;
}) {
  const [closed, setClosed] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setClosed(false);
      return;
    }
    const timer = setTimeout(() => setClosed(true), FOLD_UNMOUNT_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return (
    <div
      className={cn("spooler-fold", collapsed && "spooler-fold-collapsed")}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="spooler-fold-inner" role={role} aria-label={label}>
        {collapsed && closed ? null : children()}
      </div>
    </div>
  );
}

function renderSubtree(
  thread: PluginSidebarThread,
  depth: number,
  renderRow: (
    thread: PluginSidebarThread,
    depth: number,
    groupProjectId: string | null,
    isLastChild: boolean,
    dragHandle: RowDragHandle | null,
    hidden: boolean,
  ) => ReactNode,
  children: Map<string, PluginSidebarThread[]>,
  groupProjectId: string | null,
  collapsedIds: ReadonlySet<string>,
  isLastChild: boolean,
  draggable: boolean,
  /** Inside a closing group or family fold: still mounted, no longer shown. */
  hidden: boolean,
  /** Row droppable data + positional feedback (section grouping only). */
  dropCue: { threadId: string; zone: "above" | "below" | "onto" } | null,
): ReactNode {
  const kids = depth > 25 ? [] : (children.get(thread.id) ?? []);
  const folded = collapsedIds.has(thread.id);
  const rowNode =
    draggable && depth === 0 ? (
      <DraggableThreadRow
        threadId={thread.id}
        dropData={{ kind: "threaddrop", threadId: thread.id, sectionId: thread.sectionId }}
        dropCue={dropCue !== null && dropCue.threadId === thread.id ? dropCue.zone : null}
        renderRow={(handle) =>
          renderRow(thread, depth, groupProjectId, isLastChild, handle, hidden)
        }
      />
    ) : (
      renderRow(thread, depth, groupProjectId, isLastChild, null, hidden)
    );
  const node = (
    <Fragment key={thread.id}>
      {rowNode}
      {kids.length === 0 ? null : (
        <Fold collapsed={folded} role="group" label="Replies">
          {() =>
            kids.map((child, index) =>
              renderSubtree(
                child,
                depth + 1,
                renderRow,
                children,
                groupProjectId,
                collapsedIds,
                index === kids.length - 1,
                false,
                hidden || folded,
                null,
              ),
            )
          }
        </Fold>
      )}
    </Fragment>
  );

  if (depth === 0) {
    return (
      <div key={thread.id} className="spooler-thread-cluster" role="listitem">
        {node}
      </div>
    );
  }

  return node;
}

const problem = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function SpoolerThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(() =>
    readStored(LIFECYCLE_KEY, "active", ["active", "archived", "all"]),
  );
  const [grouping, setGrouping] = useState<Grouping>(() =>
    // Section grouping is the shipped default: it is the organizing view this
    // sidebar is built around; an explicit stored choice still wins.
    readStored(GROUPING_KEY, "section", ["time", "project", "section"]),
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readStored(STATUS_FILTER_KEY, "all", ["all", "live", "waiting", "unread"]),
  );
  const settings = useSidebarSettings();
  /**
   * Density is stored as an override: "auto" (or nothing) follows the server
   * `defaultDensity`, an explicit value wins. Toggling back onto the server
   * default clears the override, so the setting becomes authoritative again
   * instead of being locked out forever by one stray click.
   */
  const [densityOverride, setDensityOverride] = useState<
    DensityMode | "auto"
  >(() => readStored(DENSITY_KEY, "auto", ["auto", "comfortable", "compact"]));
  const density: DensityMode =
    densityOverride === "auto" ? settings.defaultDensity : densityOverride;
  const cycleDensity = () => {
    const next: DensityMode = density === "compact" ? "comfortable" : "compact";
    const stored = next === settings.defaultDensity ? "auto" : next;
    setDensityOverride(stored);
    writeStored(DENSITY_KEY, stored);
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keyboardFocusedId, setKeyboardFocusedId] = useState<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(readStringArray(COLLAPSED_KEY)),
  );
  const [projectOrder, setProjectOrder] = useState<string[]>(() =>
    readStringArray(PROJECT_ORDER_KEY),
  );
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(
    null,
  );
  const draggingThreadIds = useRef<string[]>([]);
  const [groupMenu, setGroupMenu] = useState<{
    x: number;
    y: number;
    /** When the target is a filed section: drives Rename / Change color. */
    section: { id: string; name: string } | null;
    /** Second stage of the menu: the Change Color swatch list. */
    stage: "actions" | "colors";
  } | null>(null);
  const [sectionColorMap, setSectionColorMap] = useState<SectionColorMap>(
    () => readSectionColorMap(),
  );
  // Colors may be picked elsewhere (the plugin's settings section): re-read
  // on the change event instead of forcing a sidebar reload.
  useEffect(
    () => onSectionColorsChanged(() => setSectionColorMap(readSectionColorMap())),
    [],
  );
  const applySectionColor = useCallback(
    (sectionId: string, colorId: string) => {
      setSectionColorMap((previous) => {
        const next = colorId === SECTION_COLOR_NONE
          ? (() => {
              const copy = { ...previous };
              delete copy[sectionId];
              return copy;
            })()
          : { ...previous, [sectionId]: colorId };
        writeSectionColorMap(next);
        return next;
      });
    },
    [],
  );
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(
    null,
  );
  const justDragged = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter:
        grouping === "project"
          ? sortableKeyboardCoordinates
          : defaultKeyboardCoordinateGetter,
    }),
  );
  // Regrouping remounts every row: run it as a transition so the click
  // itself never freezes, with a subtle dim while the swap lands.
  const [switchPending, startSwitch] = useTransition();
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(
    () => new Set(readStringArray(COLLAPSED_THREADS_KEY)),
  );
  // Fold state persists from an effect, not from inside the state updaters.
  useEffect(() => {
    writeStored(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);
  useEffect(() => {
    writeStored(COLLAPSED_THREADS_KEY, JSON.stringify([...collapsedThreads]));
  }, [collapsedThreads]);
  // Typing stays responsive: the heavy list derivation trails the input.
  const deferredQuery = useDeferredValue(query);
  // Filtering forces everything open so matches never hide inside folds.
  const isFiltering = deferredQuery.trim() !== "" || statusFilter !== "all";
  const collapseIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsedThreads;
  const collapsedGroupIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsed;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    threadId: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped to revalidate per-thread model info (cheap, cached reads).
  const [modelEpoch, setModelEpoch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const onFocus = () => setModelEpoch((epoch) => epoch + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const lifecyclesParam = useMemo(
    () => ({
      experimental_lifecycles:
        lifecycle === "all"
          ? (["active", "archived"] as const)
          : ([lifecycle] as const),
    }),
    [lifecycle],
  );
  const {
    status,
    threads,
    projects,
    sections,
    experimental_archived,
  } = experimental_useSidebarThreads(lifecyclesParam);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const runtimePluginId = experimental_usePluginId();
  const isDark = useThemeIsDark();

  const commitSectionRename = useCallback(
    async (sectionId: string, title: string) => {
      try {
        // The realtime snapshot carries the new name into the header (and
        // every other view) on its own — nothing more to refresh here.
        await sdk.threadSections.update({ id: sectionId, name: title });
        toast.success(`Section renamed to “${title}”`);
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? `Couldn’t rename section: ${cause.message}`
            : "Couldn’t rename section.",
        );
      }
    },
    [sdk],
  );

  // Spool state: bulk per-thread plugin metadata (pluginId "spools"), folded
  // into resolved spools by the hook, refetching when mutations land.
  const spoolStore = useSpools({
    threads,
    pluginId: runtimePluginId || "spools",
    sdk: sdk as unknown as Parameters<typeof useSpools>[0]["sdk"],
  });
  const spoolIdByThreadId = useMemo(() => {
    const map = new Map<string, string>();
    for (const spool of spoolStore.spools) {
      for (const memberId of spool.members) map.set(memberId, spool.id);
    }
    return map;
  }, [spoolStore.spools]);
  const spoolById = useMemo(
    () => new Map(spoolStore.spools.map((spool) => [spool.id, spool])),
    [spoolStore.spools],
  );
  // Spools that first appear after the initial mount start collapsed, so a
  // newly created or newly-joined spool doesn't blast the whole member list
  // open. The first observation only records ids: pre-existing spools keep
  // whatever stored collapse state they already have.
  const seenSpoolIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(spoolStore.spools.map((spool) => spool.id));
    const previous = seenSpoolIdsRef.current;
    seenSpoolIdsRef.current = ids;
    if (previous === null) return;
    const fresh: string[] = [];
    for (const id of ids) if (!previous.has(id)) fresh.push(`spool:${id}`);
    if (fresh.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [spoolStore.spools]);
  const [editingSpoolId, setEditingSpoolId] = useState<string | null>(null);
  const [draggingSpoolId, setDraggingSpoolId] = useState<string | null>(null);
  const [spoolMenu, setSpoolMenu] = useState<{ x: number; y: number; spoolId: string } | null>(null);
  const [unspoolConfirmId, setUnspoolConfirmId] = useState<string | null>(null);
  /** Positional drop feedback for row droppables during a section drag. */
  const [rowDrop, setRowDrop] = useState<{
    threadId: string;
    zone: "above" | "below" | "onto";
  } | null>(null);
  /** Toolbar Layers button → member navigation dropdown. */
  const [spoolNavOpen, setSpoolNavOpen] = useState<{ x: number; y: number } | null>(
    null,
  );
  // The host-rendered palette commands run in this same bundle and ask for a
  // picker through the bus; the sidebar owns the thread resolution and the
  // overlay (no right-hand thread panel involved anymore).
  const [paletteIntent, setPaletteIntent] = useState<PaletteIntent | null>(null);
  const { providers } = experimental_useProviders();
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  // The host most threads run on is treated as home: its name is omitted
  // from rows, so only threads running somewhere unusual get labeled.
  const primaryHostId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.isHidden || !thread.host) continue;
      counts.set(thread.host.id, (counts.get(thread.host.id) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  }, [threads]);



  const celebrateIds = useArrivals(threads);

  const {
    allRows,
    rowById,
    childrenOf,
    statusCounts,
    shownChildren,
    countSubtree,
    pinnedGroup,
    groups,
    shownTotal,
    projectNameFor,
    sectionById,
  } = useThreadGroups({
    threads,
    query: deferredQuery,
    statusFilter,
    grouping,
    projectOrder,
    projects,
    sections,
    now,
    spools: spoolStore.spools,
    spoolIdByThreadId,
  });

  // List-wide dispatch surface (the rows bind their own per-thread hook).
  // Navigation and plain SDK mutations cover bulk and keyboard ops; the row
  // context menu mounts ThreadActionBridge so `archive` and `requestDelete`
  // for its thread run the host's per-thread bindings (delete opens bb's
  // child-count confirmation) instead of raw mutations.
  const threadActionRegistry = useRef<ThreadActionRegistry>(new Map());
  // `actions` must hold a stable identity across host snapshot pushes or the
  // row memo comparator re-renders every row wholesale. `rowById` is only
  // consulted inside the callbacks, so it is read through a ref instead of
  // being a memo dependency.
  const rowByIdRef = useRef(rowById);
  rowByIdRef.current = rowById;
  // Same ref trick for the spool maps: `actions` must stay stable across spool
  // refreshes or every row re-renders wholesale.
  const spoolIdByThreadIdRef = useRef(spoolIdByThreadId);
  spoolIdByThreadIdRef.current = spoolIdByThreadId;
  const spoolStoreRef = useRef(spoolStore);
  spoolStoreRef.current = spoolStore;
  const paletteIntentRef = useRef<PaletteIntent | null>(paletteIntent);
  paletteIntentRef.current = paletteIntent;
  // Subscribe once. While a picker is open further intents are dropped (the
  // visible picker already targets a thread); unknown threads are rejected
  // with an error toast instead of opening an empty picker.
  useEffect(
    () =>
      onPaletteIntent((next) => {
        if (paletteIntentRef.current) return;
        if (!rowByIdRef.current.get(next.threadId)) {
          toast.error("Thread isn't in the spools list.");
          return;
        }
        setPaletteIntent(next);
      }),
    [],
  );
  const actions = useMemo<SpoolerThreadActions>(() => ({
    open: (threadId, options) => navigate.toThread(threadId, options),
    openNewThread: (options) => navigate.toCompose({ focusPrompt: true, ...options }),
    archive: (threadId) => {
      const runArchive = () => {
        const bound = threadActionRegistry.current.get(threadId);
        if (bound) return bound.archive();
        // No row binding (e.g. bulk): fall back to the plain mutations, with
        // unarchive for the threads the All view shows as archived.
        return rowByIdRef.current.get(threadId)?.isArchived
          ? sdk.threads.unarchive({ threadId }).then(noop)
          : sdk.threads.archive({ threadId }).then(noop);
      };
      // Archiving a member drops its membership first, so the spool card
      // reflects it; a failed release must not block the archive itself.
      // (Unarchiving deliberately does NOT rejoin the spool.)
      const spoolId = spoolIdByThreadIdRef.current.get(threadId);
      if (!spoolId) return runArchive();
      return spoolStoreRef.current
        .releaseThread(threadId)
        .catch(() => undefined)
        .then(runArchive);
    },
    setPinned: (threadId, pinned) =>
      pinned
        ? sdk.threads.pin({ threadId }).then(noop)
        : sdk.threads.unpin({ threadId }).then(noop),
    setRead: (threadId, read) =>
      read
        ? sdk.threads.markRead({ threadId }).then(noop)
        : sdk.threads.markUnread({ threadId }).then(noop),
    requestDelete: (threadId) => {
      const bound = threadActionRegistry.current.get(threadId);
      return bound
        ? bound.requestDelete()
        : sdk.threads
            .delete({ threadId, childThreadsConfirmed: false })
            .then(noop);
    },
    rename: (threadId, title) =>
      sdk.threads.update({ threadId, title }).then(() => undefined),
  }), [navigate, sdk]);

  const activeGroup = useMemo(
    () => (dragActiveId ? (groups.find((g) => g.id === dragActiveId) ?? null) : null),
    [groups, dragActiveId],
  );

  const toggleGroup = useCallback((id: string) => {
    if (justDragged.current) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allGroupIds = useMemo(
    () => [
      ...(pinnedGroup ? [pinnedGroup.id] : []),
      ...groups.map((g) => g.id),
    ],
    [pinnedGroup, groups],
  );

  const areAllGroupsCollapsed = useMemo(() => {
    if (allGroupIds.length === 0) return false;
    return allGroupIds.every((id) => collapsedGroupIds.has(id));
  }, [allGroupIds, collapsedGroupIds]);

  const toggleAllGroups = useCallback(() => {
    setCollapsed((previous) =>
      allGroupIds.every((id) => previous.has(id))
        ? new Set<string>()
        : new Set(allGroupIds),
    );
  }, [allGroupIds]);

  const expandAllGroups = useCallback(() => {
    setCollapsed(new Set<string>());
  }, []);

  const collapseAllGroups = useCallback(() => {
    setCollapsed(new Set(allGroupIds));
  }, [allGroupIds]);

  /** File the dragged thread or its selection via BB's own update API. */
  const moveThreadToSection = useCallback(
    (threadId: string, sectionId: string | null, threadIds = [threadId]) => {
      const ids = threadIds.filter((id) => {
        const thread = rowById.get(id);
        return thread && (thread.sectionId ?? null) !== sectionId;
      });
      if (ids.length === 0) return;
      const label = sectionId
        ? (sectionById.get(sectionId)?.name ?? "section")
        : "Unfiled";
      void Promise.allSettled(
        ids.map((id) => sdk.threads.update({ threadId: id, sectionId })),
      ).then((results) =>
        reportBulk(
          results,
          (count) => `Moved ${nThreads(count)} to ${label}`,
          (count) => `Couldn’t move ${nThreads(count)} to ${label}.`,
        ),
      );
    },
    [rowById, sectionById, sdk],
  );

  /** Re-file every member thread of a spool into a section (spool drag). */
  const moveSpoolToSection = useCallback(
    (spoolId: string, sectionId: string | null) => {
      const memberIds = spoolById.get(spoolId)?.members ?? [];
      if (memberIds.length === 0) return;
      moveThreadToSection(memberIds[0], sectionId, memberIds);
    },
    // spoolById must be in the deps: without it the closure sees the first
    // render's empty map and a spool drag silently does nothing.
    [moveThreadToSection, spoolById],
  );

  /** Palette "move to section": ported from the old MoveToSectionPanel. A
   * spool's rows travel together (skip members already in the destination);
   * a plain thread moves alone. */
  const paletteMoveToSection = useCallback(
    (section: PluginSidebarSection | null) => {
      const intent = paletteIntent;
      setPaletteIntent(null);
      if (!intent) return;
      const destination = section ? section.name : "Unfiled";
      const spoolId = spoolIdByThreadId.get(intent.threadId);
      const spool = spoolId ? (spoolById.get(spoolId) ?? null) : null;
      const destinationId = section?.id ?? null;
      const ids = (spool ? spool.members : [intent.threadId]).filter((id) => {
        const thread = rowById.get(id);
        return thread && (thread.sectionId ?? null) !== destinationId;
      });
      if (ids.length === 0) {
        toast.success(`Already in ${destination}.`);
        return;
      }
      void Promise.allSettled(
        ids.map((id) => sdk.threads.update({ threadId: id, sectionId: destinationId })),
      ).then((settled) => {
        const failed = settled.filter((row) => row.status === "rejected").length;
        if (failed === ids.length) {
          toast.error(`Couldn’t move to ${destination}.`);
          return;
        }
        const suffix = spool
          ? ` spool (${nThreads(ids.length)})`
          : " thread";
        toast.success(`Moved${suffix} to ${destination}.`);
      });
    },
    [paletteIntent, spoolIdByThreadId, spoolById, rowById, sdk],
  );

  /** Palette "throw onto spool": ported from the old ThrowOntoSpoolPanel; a
   * "New spool…" pick creates a spool out of the target thread alone. */
  const paletteThrowOntoSpool = useCallback(
    (spoolId: string | null) => {
      const intent = paletteIntent;
      setPaletteIntent(null);
      if (!intent) return;
      void (spoolId
        ? spoolStore.throwOntoSpool(spoolId, intent.threadId)
        : spoolStore.createSpoolFromThread(intent.threadId)
      )
        .then(() => {
          toast.success(`Threw thread onto ${spoolId ? "spool" : "new spool"}.`);
        })
        .catch((cause: unknown) =>
          toast.error(`Couldn’t throw thread onto spool: ${problem(cause)}`),
        );
    },
    [paletteIntent, spoolStore],
  );

  const commitSpoolRename = useCallback(
    (spoolId: string, title: string) => {
      setEditingSpoolId(null);
      if (!title.trim()) return;
      void spoolStore
        .renameSpool(spoolId, title)
        .catch((cause: unknown) => toast.error(problem(cause)));
    },
    [spoolStore],
  );

  /** Archive Spool Threads: archive every member (bulk, tolerant). */
  const archiveSpool = useCallback(
    (spoolId: string) => {
      const memberIds = spoolById.get(spoolId)?.members ?? [];
      void Promise.allSettled(memberIds.map((id) => actions.archive(id))).then(
        (results) =>
          reportBulk(
            results,
            (count) => `Archived ${nThreads(count)} from the spool.`,
            (count) => `Couldn't archive ${nThreads(count)} from the spool.`,
          ),
      );
    },
    [actions],
  );

  /** Release every member: destructive — the spool simply stops existing. */
  /** Destructive gate: both the card hover button and the ctx menu item land
   * here, so there is exactly one confirm modal for unspooling. */
  const requestUnspool = useCallback((spoolId: string) => {
    setUnspoolConfirmId(spoolId);
  }, []);

  const unspoolSpool = useCallback(
    (spoolId: string) => {
      void spoolStore
        .unspool(spoolId)
        .then(() => toast.success(`Spool released.`))
        .catch((cause: unknown) => toast.error(problem(cause)));
    },
    [spoolStore],
  );

  const handleGroupDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(String(event.active.id));
  }, []);

  const handleGroupDragCancel = useCallback(() => {
    setDragActiveId(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 50);
  }, []);

  const handleGroupDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveId(null);
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 50);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeProjId = String(active.id).replace(/^project:/, "");
      const overProjId = String(over.id).replace(/^project:/, "");

      const currentGroupProjIds = groups
        .map((g) => g.projectId)
        .filter((id): id is string => id !== null);

      const existing = new Set(projectOrder);
      const merged = [
        ...projectOrder.filter((id) => currentGroupProjIds.includes(id)),
        ...currentGroupProjIds.filter((id) => !existing.has(id)),
      ];

      const oldIndex = merged.indexOf(activeProjId);
      const newIndex = merged.indexOf(overProjId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const next = arrayMove(merged, oldIndex, newIndex);
        writeStored(PROJECT_ORDER_KEY, JSON.stringify(next));
        setProjectOrder(next);
      }
    },
    [groups, projectOrder],
  );

  const toggleThreadCollapse = useCallback((id: string) => {
    setCollapsedThreads((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleNewThreadInProject = useCallback(
    (projectId: string) => {
      actions.openNewThread({ projectId, focusPrompt: true });
      onNavigate();
    },
    [actions, onNavigate],
  );

  const visibleFlattenedThreadIds = useMemo(() => {
    const list: string[] = [];
    const walk = (threadList: PluginSidebarThread[], depth = 0) => {
      for (const t of threadList) {
        list.push(t.id);
        if (depth <= 25 && !collapseIds.has(t.id)) {
          const kids = shownChildren.get(t.id);
          if (kids && kids.length > 0) {
            walk(kids, depth + 1);
          }
        }
      }
    };
    if (pinnedGroup && !collapsedGroupIds.has(pinnedGroup.id)) {
      walk(pinnedGroup.roots);
    }
    for (const group of groups) {
      if (collapsedGroupIds.has(group.id)) {
        continue;
      }
      // Spool members render BEFORE the section's ordinary rows (their cards
      // sit at the top of the bucket) and their rows show hover cards too.
      for (const spool of group.spools ?? []) {
        if (collapsedGroupIds.has(`spool:${spool.id}`)) {
          continue;
        }
        for (const member of spool.members) {
          list.push(member.id);
        }
      }
      walk(group.roots);
    }
    return list;
  }, [pinnedGroup, groups, collapsedGroupIds, collapseIds, shownChildren]);
  const visibleThreadIds = useMemo(
    () => new Set(visibleFlattenedThreadIds),
    [visibleFlattenedThreadIds],
  );
  // Every host snapshot rebuilds the flattened order. Rows read it through a
  // ref so their select handler stays stable and the memo keeps them still.
  const visibleOrderRef = useRef(visibleFlattenedThreadIds);
  visibleOrderRef.current = visibleFlattenedThreadIds;

  const handleToggleSelect = useCallback(
    (event: { shiftKey: boolean }, threadId: string) => {
      const order = visibleOrderRef.current;
      if (event.shiftKey && lastSelectedIdRef.current) {
        const fromIdx = order.indexOf(lastSelectedIdRef.current);
        const toIdx = order.indexOf(threadId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const range = order.slice(start, end + 1);
          setSelectedIds((prev) => new Set([...prev, ...range]));
          lastSelectedIdRef.current = threadId;
          return;
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(threadId)) next.delete(threadId);
        else next.add(threadId);
        return next;
      });
      lastSelectedIdRef.current = threadId;
    },
    [],
  );

  // Selection only ever covers rows the list still shows: a filter or
  // lifecycle change must not leave invisible threads armed for bulk actions.
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set([...previous].filter((id) => visibleThreadIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
    if (lastSelectedIdRef.current && !visibleThreadIds.has(lastSelectedIdRef.current)) {
      lastSelectedIdRef.current = null;
    }
  }, [visibleThreadIds]);

  useEffect(() => {
    const hiddenKeyboardId = keyboardFocusedId && !visibleThreadIds.has(keyboardFocusedId)
      ? keyboardFocusedId : null;
    if (hiddenKeyboardId) setKeyboardFocusedId(null);
    const focusedRow = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-sidebar-thread-id]") : null;
    const focusedRowId = focusedRow && rootRef.current?.contains(focusedRow)
      ? focusedRow.getAttribute("data-sidebar-thread-id") : null;
    const hiddenFocusId = focusedRowId && !visibleThreadIds.has(focusedRowId)
      ? focusedRowId
      : document.activeElement === document.body ? hiddenKeyboardId : null;
    if (!hiddenFocusId) return;
    // A closing fold keeps its rows mounted while it animates. Move focus out
    // of hidden rows, preserving focus on any visible control the user
    // clicked to fold them.
    let parentId = rowById.get(hiddenFocusId)?.parentThreadId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (visibleThreadIds.has(parentId)) break;
      parentId = rowById.get(parentId)?.parentThreadId;
    }
    const parent = parentId && visibleThreadIds.has(parentId)
      ? rootRef.current?.querySelector<HTMLElement>(`[data-sidebar-thread-id="${parentId}"]`)
      : null;
    const groupControl = focusedRow?.closest("section")?.querySelector<HTMLElement>(".spooler-group-toggle");
    (parent || groupControl || searchInputRef.current)?.focus({ preventScroll: true });
  }, [keyboardFocusedId, visibleThreadIds, rowById]);

  const handleBulkArchive = useCallback(() => {
    for (const id of selectedIds) {
      if (visibleThreadIds.has(id)) actions.archive(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, actions, visibleThreadIds]);

  const handleBulkPin = useCallback(async () => {
    const ids = [...selectedIds];
    const pin = !ids.every((id) => rowById.get(id)?.isPinned);
    setSelectedIds(new Set());
    const results = await Promise.allSettled(
      ids.map((id) => actions.setPinned(id, pin)),
    );
    reportBulk(
      results,
      (count) => `${pin ? "Pinned" : "Unpinned"} ${nThreads(count)}`,
      (count) => `Couldn’t ${pin ? "pin" : "unpin"} ${nThreads(count)}.`,
    );
  }, [selectedIds, rowById, actions]);

  const handleBulkMarkRead = useCallback(async () => {
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    const results = await Promise.allSettled(
      ids.map((id) => sdk.threads.markRead({ threadId: id })),
    );
    reportBulk(
      results,
      (count) => `Marked ${nThreads(count)} read`,
      (count) => `Couldn’t mark ${nThreads(count)} read.`,
    );
  }, [selectedIds, sdk]);

  useEffect(() => {
    const focusRow = (id: string) => {
      const row = rootRef.current?.querySelector<HTMLElement>(
        `[data-sidebar-thread-id="${id}"]`,
      );
      // Keep the actual keyboard target in sync with the visual highlight.
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setKeyboardFocusedId(id);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Another handler (a host menu, dialog or select) already owns this key.
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (target !== null && target === searchInputRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (query) {
            setQuery("");
          } else {
            searchInputRef.current?.blur();
          }
        } else if (event.key === "ArrowDown") {
          if (visibleFlattenedThreadIds.length > 0) {
            event.preventDefault();
            focusRow(visibleFlattenedThreadIds[0]);
          }
        } else if (event.key === "Enter") {
          if (visibleFlattenedThreadIds.length > 0) {
            event.preventDefault();
            actions.open(visibleFlattenedThreadIds[0]);
            onNavigate();
          }
        }
        return;
      }

      // Shortcuts are bare keys, so they stay out of anywhere the app owns the
      // keyboard: editable fields, open dialogs and menus, and controls
      // outside this list. Plain page chrome is fair game.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inList = target !== null && rootRef.current?.contains(target) === true;
      if (target !== null) {
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("[role='textbox'], [role='combobox']") !== null
        ) {
          return;
        }
        if (!inList) {
          const overlay =
            "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [aria-modal='true']";
          const control =
            "a, button, summary, [role='button'], [role='menuitem'], [role='tab'], [role='option'], [role='checkbox'], [role='switch']";
          if (target.closest(overlay) !== null || target.closest(control) !== null) {
            return;
          }
        }
      }
      // A focused link or button keeps its native Enter/Space behaviour.
      const onControl =
        target?.closest("a, button, [role='button'], [role='menuitem']") != null;
      // The row under focus wins over the last arrow-key position.
      const rowTarget = target?.closest<HTMLElement>("[data-sidebar-thread-id]");
      const candidateId =
        rowTarget?.getAttribute("data-sidebar-thread-id") ?? keyboardFocusedId;
      const focusedId =
        candidateId && visibleThreadIds.has(candidateId) ? candidateId : null;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.shiftKey || visibleFlattenedThreadIds.length === 0) return;
        event.preventDefault();
        const last = visibleFlattenedThreadIds.length - 1;
        const currentIdx = focusedId
          ? visibleFlattenedThreadIds.indexOf(focusedId)
          : -1;
        const nextIdx =
          event.key === "ArrowDown"
            ? currentIdx === -1 || currentIdx >= last
              ? 0
              : currentIdx + 1
            : currentIdx <= 0
              ? last
              : currentIdx - 1;
        focusRow(visibleFlattenedThreadIds[nextIdx]);
        return;
      }

      if (event.key === "Enter") {
        if (onControl || !focusedId) return;
        event.preventDefault();
        actions.open(focusedId);
        onNavigate();
        return;
      }

      if (
        event.key === " " ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft"
      ) {
        // Space folds a focused row link; nested buttons keep native behaviour.
        if (event.key === " " && onControl && target !== rowTarget) return;
        if (focusedId && (shownChildren.get(focusedId)?.length ?? 0) > 0) {
          event.preventDefault();
          toggleThreadCollapse(focusedId);
        }
        return;
      }

      if (event.key === "x" || event.key === "X") {
        if (focusedId) {
          event.preventDefault();
          handleToggleSelect(event, focusedId);
        }
        return;
      }

      if (event.key === "e" || event.key === "E") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          handleBulkArchive();
        } else if (focusedId) {
          event.preventDefault();
          actions.archive(focusedId);
        }
        return;
      }

      if (event.key === "p" || event.key === "P") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          void handleBulkPin();
        } else if (focusedId) {
          const t = rowById.get(focusedId);
          if (t) {
            event.preventDefault();
            actions.setPinned(t.id, !t.isPinned).then(
              () => {
                toast.success(t.isPinned ? "Unpinned thread" : "Pinned thread");
              },
              (cause: unknown) => {
                toast.error(problem(cause));
              },
            );
          }
        }
        return;
      }

      if (event.key === "Escape") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          setSelectedIds(new Set());
        } else if (keyboardFocusedId) {
          event.preventDefault();
          if (document.activeElement === rowTarget) rowTarget?.blur();
          setKeyboardFocusedId(null);
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    query,
    visibleFlattenedThreadIds,
    visibleThreadIds,
    keyboardFocusedId,
    selectedIds,
    shownChildren,
    toggleThreadCollapse,
    handleToggleSelect,
    actions,
    onNavigate,
    handleBulkArchive,
    handleBulkPin,
    rowById,
  ]);

  const markFamilyRead = useCallback(
    async (thread: PluginSidebarThread) => {
      // Whole tree: walk up to the root, then mark root + descendants.
      let root = thread;
      const ancestors = new Set<string>([thread.id]);
      while (
        root.parentThreadId &&
        rowById.has(root.parentThreadId) &&
        !ancestors.has(root.parentThreadId)
      ) {
        ancestors.add(root.parentThreadId);
        root = rowById.get(root.parentThreadId)!;
      }
      const ids = [root.id];
      const seen = new Set<string>(ids);
      const walk = (id: string, depth: number) => {
        if (depth > 25) return;
        for (const child of childrenOf.get(id) ?? []) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          ids.push(child.id);
          walk(child.id, depth + 1);
        }
      };
      walk(root.id, 0);
      const results = await Promise.allSettled(
        ids.map((id) => sdk.threads.markRead({ threadId: id })),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failed > 0) {
        toast.error(
          `Couldn't mark ${failed} thread${failed === 1 ? "" : "s"} read.`,
        );
      }
    },
    [rowById, childrenOf, sdk],
  );

  const openMenu = useCallback(
    (clientX: number, clientY: number, thread: PluginSidebarThread) => {
      setEditingId(null);
      setMenu({ x: clientX, y: clientY, threadId: thread.id });
    },
    [],
  );

  /** Threads beyond this one can be thrown to any spool but their own. */
  const spoolThrowTargetIds = useCallback(
    (threadId: string) =>
      [...spoolById.values()]
        .filter((spool) => spoolIdByThreadId.get(threadId) !== spool.id)
        .map((spool) => spool.id),
    [spoolById, spoolIdByThreadId],
  );

  /** Which section keeps the spool (lead filed there). */
  const spoolMenuSectionOf = useCallback(
    (spoolId: string) => {
      const spool = spoolById.get(spoolId);
      const lead = spool?.leadThreadId ? rowById.get(spool.leadThreadId) : null;
      return lead?.sectionId ?? null;
    },
    [spoolById, rowById],
  );

  const menuThread = menu
    ? (threads.find((thread) => thread.id === menu.threadId) ?? null)
    : null;

  const menuItems = useMemo<SpoolerMenuItem[]>(() => {
    if (!menuThread) return [];
    const items: SpoolerMenuItem[] = [
      { kind: "item", id: "open-split", label: "Open in split", icon: "Columns2" },
      {
        kind: "item",
        id: "pin",
        label: menuThread.isPinned ? "Unpin" : "Pin",
        icon: menuThread.isPinned ? "PinOff" : "Pin",
        checked: menuThread.isPinned,
      },
      {
        kind: "item",
        id: "read",
        label: menuThread.isUnread ? "Mark as read" : "Mark as unread",
        icon: menuThread.isUnread ? "MailOpen" : "Mail",
      },
      ...(menuThread.parentThreadId !== null ||
      (childrenOf.get(menuThread.id)?.length ?? 0) > 0
        ? [
            {
              kind: "item",
              id: "family-read",
              label: "Mark family read",
              icon: "MailOpen",
            } as SpoolerMenuItem,
          ]
        : []),
      { kind: "item", id: "rename", label: "Rename…", icon: "Edit" },
      // Spool actions under one "Spools" header: members get a release plus
      // throw targets (spools never nest, throw breaks out first); plain
      // threads create a spool or throw onto an existing one.
      ...(spoolIdByThreadId.has(menuThread.id)
        ? [
            {
              kind: "separator" as const,
            },
            {
              kind: "header" as const,
              label: "Spools",
            },
            {
              kind: "item" as const,
              id: "spool:release",
              label: "Remove from spool",
              icon: "ListCollapse",
            },
          ]
        : [
            {
              kind: "item" as const,
              id: "spool:create",
              label: "Create Spool from this Thread",
              icon: "🧵",
            },
          ]),
      ...(spoolThrowTargetIds(menuThread.id).length > 0
        ? [
            // A member's release already sits under the Spools header; a
            // plain thread still needs the header before its throw targets.
            ...(spoolIdByThreadId.has(menuThread.id)
              ? []
              : [
                  {
                    kind: "separator" as const,
                  },
                  {
                    kind: "header" as const,
                    label: "Spools",
                  },
                ]),
            ...spoolThrowTargetIds(menuThread.id).map(
              (spoolId): SpoolerMenuItem => ({
                kind: "item" as const,
                id: `spool-throw:${spoolId}`,
                label: spoolById.get(spoolId)?.title ?? "Spool",
                icon: "Layers",
              }),
            ),
          ]
        : []),
      { kind: "separator" },
      { kind: "header", label: "Move to section" },
      ...sections.map(
        (section): SpoolerMenuItem => ({
          kind: "item",
          id: `section:${section.id}`,
          label: section.name,
          icon: "Folder",
          checked: menuThread.sectionId === section.id,
        }),
      ),
      ...(menuThread.sectionId
        ? [
            {
              kind: "item",
              id: "section-none",
              label: "No section",
              icon: "Folder",
            } as SpoolerMenuItem,
          ]
        : []),
      { kind: "separator" },
      ...(menuThread.isArchived
        ? [
            {
              kind: "item",
              id: "unarchive",
              label: "Unarchive",
              icon: "ArchiveRestore",
            } as SpoolerMenuItem,
          ]
        : [
            {
              kind: "item",
              id: "archive",
              label: "Archive",
              icon: "Archive",
            } as SpoolerMenuItem,
          ]),
      { kind: "item", id: "copy-link", label: "Copy link", icon: "Copy" },
      {
        kind: "item",
        id: "delete",
        label: "Delete…",
        icon: "Trash2",
        danger: true,
      },
    ];
    return items;
  }, [menuThread, sections, childrenOf, spoolById, spoolIdByThreadId, spoolThrowTargetIds]);

  const handleMenuSelect = useCallback(
    async (id: string) => {
      const thread = menuThread;
      setMenu(null);
      if (!thread) return;
      try {
        if (id === "open-split") {
          actions.open(thread.id, { split: true });
          onNavigate();
        } else if (id === "pin") {
          await actions.setPinned(thread.id, !thread.isPinned);
        } else if (id === "read") {
          await actions.setRead(thread.id, thread.isUnread);
        } else if (id === "family-read") {
          await markFamilyRead(thread);
        } else if (id === "rename") {
          setEditingId(thread.id);
        } else if (id === "spool:create") {
          await spoolStore.createSpoolFromThread(thread.id);
          toast.success(`Spool created from thread.`);
        } else if (id === "spool:release") {
          await spoolStore.releaseThread(thread.id);
        } else if (id.startsWith("spool-throw:")) {
          await spoolStore.throwOntoSpool(id.slice("spool-throw:".length), thread.id);
        } else if (id === "archive") {
          actions.archive(thread.id);
        } else if (id === "unarchive") {
          await sdk.threads.unarchive({ threadId: thread.id });
        } else if (id === "copy-link") {
          await navigator.clipboard.writeText(
            `${window.location.origin}${thread.href}`,
          );
          toast.success("Link copied");
        } else if (id === "delete") {
          actions.requestDelete(thread.id);
        } else if (id === "section-none") {
          await sdk.threads.update({ threadId: thread.id, sectionId: null });
        } else if (id.startsWith("section:")) {
          await sdk.threads.update({
            threadId: thread.id,
            sectionId: id.slice("section:".length),
          });
        }
      } catch (cause) {
        toast.error(problem(cause));
      }
    },
    [menuThread, actions, sdk, onNavigate, markFamilyRead, spoolStore],
  );

  const commitRename = useCallback(
    async (thread: PluginSidebarThread, title: string) => {
      setEditingId(null);
      const next = title.trim();
      if (next === "" || next === (thread.title ?? "")) return;
      try {
        await actions.rename(thread.id, next);
      } catch (cause) {
        toast.error(problem(cause));
      }
    },
    [actions],
  );

  const startRename = useCallback(
    (target: PluginSidebarThread) => setEditingId(target.id),
    [],
  );
  const cancelRename = useCallback(() => setEditingId(null), []);

  const unarchive = useCallback(
    (thread: PluginSidebarThread) => {
      sdk.threads.unarchive({ threadId: thread.id }).catch((cause: unknown) => {
        toast.error(problem(cause));
      });
    },
    [sdk],
  );

  const renderRow = useCallback(
    (
      thread: PluginSidebarThread,
      depth: number,
      groupProjectId: string | null,
      isLastChild: boolean,
      dragHandle: RowDragHandle | null,
      hidden: boolean,
    ) => {
      const kidCount = (shownChildren.get(thread.id) ?? []).length;
      const counts = kidCount > 0 ? countSubtree(thread) : null;
      const collapse =
        kidCount > 0 && counts
          ? {
              collapsed: collapseIds.has(thread.id),
              hiddenTotal: counts.total - 1,
              hiddenUnread:
                counts.unread - (thread.isUnread ? 1 : 0),
              hiddenLive: counts.live - Number(isRunningThread(thread)) > 0,
              hiddenNeedsUser:
                counts.needsUser -
                  Number(thread.indicator === "waiting-for-input") > 0,
              hiddenFailed:
                counts.failed - Number(
                  thread.indicator === "unread-error" ||
                  thread.indicator === "queued-failed",
                ) > 0,
              hiddenKids: counts.kids,
              onToggle: () => toggleThreadCollapse(thread.id),
            }
          : null;
      const provider = providerById.get(thread.providerId) ?? null;
      return (
        <SpoolerThreadRow
          key={thread.id}
          thread={thread}
          depth={depth}
          isLastChild={isLastChild}
          projectName={projectNameFor(thread)}
          projectTag={
            groupProjectId !== null && thread.projectId === groupProjectId
              ? null
              : projectNameFor(thread)
          }
          primaryHostId={primaryHostId}
          sectionName={
            thread.sectionId
              ? (sectionById.get(thread.sectionId)?.name ?? null)
              : null
          }
          sectionId={thread.sectionId}
          celebrate={settings.celebrate && celebrateIds.has(thread.id)}
          allowHoverCard={settings.hoverCard}
          adaptiveCollapse={settings.adaptiveCollapse}
          isActive={thread.id === activeThreadId}
          isEditing={thread.id === editingId}
          isVisible={visibleThreadIds.has(thread.id)}
          actions={actions}
          timeText={timeAgo(activityTime(thread, now), now)}
          onNavigate={onNavigate}
          onOpenMenu={openMenu}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onCancelRename={cancelRename}
          onUnarchive={unarchive}
          providerName={provider?.displayName ?? thread.providerId}
          providerIcon={provider}
          collapse={collapse}
          sdk={sdk}
          modelEpoch={modelEpoch}
          density={density}
          isSelected={selectedIds.has(thread.id)}
          selectedIds={selectedIds.has(thread.id) ? selectedIds : undefined}
          selectionActive={selectedIds.size > 0}
          isKeyboardFocused={keyboardFocusedId === thread.id}
          onToggleSelect={handleToggleSelect}
          dragHandle={dragHandle}
          swipeRight={settings.swipeRight}
          swipeLeft={settings.swipeLeft}
          listFiltersArchived={lifecycle !== "all"}
          hasChildren={(childrenOf.get(thread.id)?.length ?? 0) > 0}
          isShortcutTarget={!hidden}
        />
      );
    },
    [
      projectNameFor,
      sectionById,
      celebrateIds,
      settings.celebrate,
      settings.hoverCard,
      settings.adaptiveCollapse,
      settings.swipeRight,
      settings.swipeLeft,
      lifecycle,
      activeThreadId,
      editingId,
      actions,
      now,
      onNavigate,
      openMenu,
      commitRename,
      startRename,
      cancelRename,
      unarchive,
      providerById,
      primaryHostId,
      shownChildren,
      childrenOf,
      collapseIds,
      countSubtree,
      toggleThreadCollapse,
      sdk,
      modelEpoch,
      density,
      selectedIds,
      keyboardFocusedId,
      handleToggleSelect,
      visibleThreadIds,
    ],
  );

  const renderGroup = useCallback(
    (group: ThreadGroup, isSortable = false, draggable = false) => {
      const isCollapsed = collapsedGroupIds.has(group.id);
      // The Settled shelf is a read-mostly bucket: no section drop target
      // (dropping would write a bogus sectionId), no sortable handle in the
      // project reorder flow, no section context menu.
      const isSettled = group.id === SETTLED_GROUP_ID;

      const groupContextMenu = isSettled
        ? undefined
        : (event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            // Section groups (Group By Section only) get section-specific
            // entries: Rename and Change color. The Unfiled pseudo-section
            // (no server record) and the Settled shelf never do.
            const section =
              grouping === "section" && group.sectionId != null
                ? { id: group.sectionId, name: group.label }
                : null;
            setGroupMenu({ x: event.clientX, y: event.clientY, section, stage: "actions" });
          };
      const groupContextMenuStrict = groupContextMenu ?? (() => undefined);

      /** Spool cards anchored in this bucket: they render INSIDE the section,
       *  above its rows (moved from standalone entries above the bucket). */
      const spoolCards = (group.spools ?? []).map((spool) => (
        <div key={`spool:${spool.id}`} className="spooler-spool-slot">
          <SpoolCard
            data={spool}
            collapsed={collapsedGroupIds.has(`spool:${spool.id}`)}
            onToggle={() => toggleGroup(`spool:${spool.id}`)}
            onOpen={(threadId) => actions.open(threadId)}
            onOpenTop={(threadId) => actions.open(threadId)}
            onOpenMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSpoolMenu({ x: event.clientX, y: event.clientY, spoolId: spool.id });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSpoolMenu({ x: event.clientX, y: event.clientY, spoolId: spool.id });
            }}
            menuOpen={spoolMenu?.spoolId === spool.id}
            isRenaming={editingSpoolId === spool.id}
            onRenameCommit={(title) => commitSpoolRename(spool.id, title)}
            onRenameCancel={() => setEditingSpoolId(null)}
            startRename={() => setEditingSpoolId(spool.id)}
            renderMember={(thread, index, isLast) => (
              <DraggableThreadRow
                threadId={thread.id}
                dropData={{
                  kind: "threaddrop",
                  threadId: thread.id,
                  sectionId: thread.sectionId,
                }}
                dropCue={
                  rowDrop !== null && rowDrop.threadId === thread.id
                    ? rowDrop.zone
                    : null
                }
                renderRow={(handle) =>
                  renderRow(thread, 1, null, isLast, handle, false)
                }
              />
            )}
            draggingThreadId={draggingThreadId}
            projectNameFor={projectNameFor}
            hasActiveThread={
              activeThreadId != null &&
              spool.members.some((member) => member.id === activeThreadId)
            }
          />
        </div>
      ));

      const foldContent = (
        <Fold
          collapsed={isCollapsed}
          role="list"
          label={`${group.label} threads`}
        >
          {() =>
            spoolCards.length === 0 && group.roots.length === 0 ? (
              <p className="spooler-group-empty">Drop a thread here to file it.</p>
            ) : (
              <>
                {spoolCards}
                {group.roots.map((root, index) =>
                  renderSubtree(
                    root,
                    0,
                    renderRow,
                    shownChildren,
                    group.projectId,
                    collapseIds,
                    index === group.roots.length - 1,
                    draggable && !isSettled,
                    isCollapsed,
                    rowDrop,
                  ),
                )}
              </>
            )
          }
        </Fold>
      );

      if (isSortable && !isSettled) {
        return (
          <SortableGroupSection
            key={group.id}
            group={group}
            isCollapsed={isCollapsed}
            onToggle={() => toggleGroup(group.id)}
            onNewThread={
              group.projectId
                ? () => handleNewThreadInProject(group.projectId!)
                : undefined
            }
            onContextMenu={groupContextMenuStrict}
          >
            {foldContent}
          </SortableGroupSection>
        );
      }

      const isSectionBucket = grouping === "section" && group.sectionId != null;
      const sectionColor = isSectionBucket
        ? sectionColorOption(sectionColorMap, group.sectionId)
        : null;
      const sectionColorStyle = sectionColor
        ? sectionColorVars(sectionColor, isDark)
        : null;

      const plainSection = (
        <section
          key={group.id}
          aria-label={group.label}
          className={cn(
            "spooler-group",
            group.projectId && "spooler-group-project",
            isSettled && "spooler-group-settled",
            isSectionBucket && "spooler-group-bucket",
            isSectionBucket && sectionColor && "spooler-group-colored",
            isCollapsed ? "spooler-group-collapsed" : "spooler-group-expanded",
          )}
          style={sectionColorStyle ?? undefined}
          data-settled={isSettled || undefined}
        >
          <GroupHeader
            group={group}
            isCollapsed={isCollapsed}
            onToggle={() => toggleGroup(group.id)}
            onContextMenu={groupContextMenuStrict}
            onNewThread={
              group.projectId
                ? () => handleNewThreadInProject(group.projectId!)
                : undefined
            }
            renaming={isSectionBucket && renamingSectionId === group.id}
            onRenameCommit={(title) => {
              if (group.sectionId == null) return;
              setRenamingSectionId(null);
              void commitSectionRename(group.sectionId, title);
            }}
            onRenameCancel={() => setRenamingSectionId(null)}
          />
          {foldContent}
        </section>
      );

      return draggable && !isSettled ? (
        <DroppableSectionSection
          key={group.id}
          group={group}
          draggingThreadId={draggingThreadId}
          draggingSpoolId={draggable ? draggingSpoolId : null}
          draggingSpoolSectionId={
            draggable && draggingSpoolId != null
              ? spoolMenuSectionOf(draggingSpoolId)
              : null
          }
          onDropThread={moveThreadToSection}
        >
          {plainSection}
        </DroppableSectionSection>
      ) : (
        plainSection
      );
    },
    [
      collapsedGroupIds,
      toggleGroup,
      handleNewThreadInProject,
      renderRow,
      shownChildren,
      collapseIds,
      projectOrder.length,
      draggingThreadId,
      draggingSpoolId,
      spoolMenuSectionOf,
      moveThreadToSection,
      actions,
      archiveSpool,
      unspoolSpool,
      editingSpoolId,
      commitSpoolRename,
      setEditingSpoolId,
      rowDrop,
      projectNameFor,
      spoolMenu,
      grouping,
      sectionColorMap,
      isDark,
      renamingSectionId,
      commitSectionRename,
      activeThreadId,
    ],
  );

  const selectLifecycle = (next: LifecycleFilter) => {
    if (next === lifecycle) return;
    writeStored(LIFECYCLE_KEY, next);
    startSwitch(() => setLifecycle(next));
  };
  const selectGrouping = (next: Grouping) => {
    if (next === grouping) return;
    writeStored(GROUPING_KEY, next);
    startSwitch(() => setGrouping(next));
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "spooler-list",
        (density === "compact" || isCompactViewport) && "spooler-density-compact",
        isCompactViewport && "spooler-list-compact",
        settings.wrapTitles && "spooler-title-wrap",
      )}
      data-spooler-motion={settings.motion ? "on" : "off"}
      data-spooler-loud-unread={settings.loudUnread ? "on" : "off"}
      data-spooler-swipe={
        settings.swipeRight !== "none" || settings.swipeLeft !== "none"
          ? "on"
          : "off"
      }
    >
      <div className="spooler-list-header">
        <div className="spooler-search">
          <Icon
            name="Search"
            aria-hidden="true"
            className="spooler-search-icon"
          />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter threads…"
            aria-label="Filter threads"
            role="searchbox"
            className="spooler-search-input"
          />
          {query !== "" ? (
            <button
              type="button"
              aria-label="Clear filter"
              title="Clear filter"
              className="spooler-search-clear"
              onClick={() => setQuery("")}
            >
              <Icon name="X" aria-hidden="true" />
            </button>
          ) : (
            <kbd className="spooler-search-shortcut" title="Press / to focus search">
              /
            </kbd>
          )}
        </div>
        <div className="spooler-filters">
          <div
            role="group"
            aria-label="Thread lifecycle"
            className="spooler-segmented"
          >
            {(
              [
                ["active", "Active"],
                ["archived", "Archived"],
                ["all", "All"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={lifecycle === value}
                className={cn(
                  "spooler-segmented-button",
                  lifecycle === value && "spooler-segmented-button-active",
                )}
                onClick={() => selectLifecycle(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Grouping" className="spooler-segmented">
            <button
              type="button"
              aria-pressed={grouping === "section"}
              aria-label="Group by section (drag threads between them)"
              title="Group by section — drag a thread onto a header to file it"
              className={cn(
                "spooler-segmented-button spooler-segmented-icon",
                grouping === "section" && "spooler-segmented-button-active",
              )}
              onClick={() => selectGrouping("section")}
            >
              <Icon name="SectionMove" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-pressed={grouping === "time"}
              aria-label="Group by time"
              title="Group by time"
              className={cn(
                "spooler-segmented-button spooler-segmented-icon",
                grouping === "time" && "spooler-segmented-button-active",
              )}
              onClick={() => selectGrouping("time")}
            >
              <Icon name="Clock" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-pressed={grouping === "project"}
              aria-label="Group by project"
              title="Group by project"
              className={cn(
                "spooler-segmented-button spooler-segmented-icon",
                grouping === "project" && "spooler-segmented-button-active",
              )}
              onClick={() => selectGrouping("project")}
            >
              <Icon name="Folder" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={
                areAllGroupsCollapsed
                  ? "Expand all folders"
                  : "Collapse all folders"
              }
              title={
                areAllGroupsCollapsed
                  ? "Expand all folders"
                  : "Collapse all folders"
              }
              className="spooler-segmented-button spooler-segmented-icon"
              onClick={toggleAllGroups}
            >
              <Icon
                name={areAllGroupsCollapsed ? "Expand" : "Collapse"}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              aria-pressed={density === "compact"}
              aria-label={density === "compact" ? "Comfortable view" : "Compact view"}
              title={
                density === "compact"
                  ? "Switch to comfortable view"
                  : "Switch to compact view"
              }
              className={cn(
                "spooler-segmented-button spooler-segmented-icon",
                density === "compact" && "spooler-segmented-button-active",
              )}
              onClick={cycleDensity}
            >
              <Icon
                name={density === "compact" ? "ListView" : "Rows2"}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={spoolNavOpen !== null}
              disabled={spoolStore.spools.length === 0}
              aria-label="Spools"
              title={
                spoolStore.spools.length === 0
                  ? "No spools yet"
                  : "Spools — open a member thread"
              }
              className="spooler-segmented-button spooler-segmented-icon"
              onClick={(event) => {
                if (spoolNavOpen) {
                  setSpoolNavOpen(null);
                  return;
                }
                setSpoolNavOpen({ x: event.clientX, y: event.clientY });
              }}
            >
              <span aria-hidden="true" className="spooler-spool-emoji">🧵</span>
            </button>
          </div>
        </div>

        <div className="spooler-chip-row">
          <div
            role="radiogroup"
            aria-label="Status filter"
            className="spooler-status-chips"
          >
            <button
              type="button"
              role="radio"
              aria-checked={statusFilter === "all"}
              className={cn(
                "spooler-chip",
                statusFilter === "all" && "spooler-chip-active",
              )}
              onClick={() => {
                setStatusFilter("all");
                writeStored(STATUS_FILTER_KEY, "all");
              }}
            >
              All
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={statusFilter === "live"}
              className={cn(
                "spooler-chip",
                "spooler-chip-iconic",
                statusFilter === "live" && "spooler-chip-active",
              )}
              aria-label="Live"
              onClick={() => {
                const next = statusFilter === "live" ? "all" : "live";
                setStatusFilter(next);
                writeStored(STATUS_FILTER_KEY, next);
              }}
              title="Filter live / active threads"
            >
              <span
                className={cn(
                  "spooler-chip-indicator spooler-tone-running",
                  statusCounts.live > 0 && "spooler-icon-pulse",
                )}
              >
                <Icon name="Zap" aria-hidden="true" />
              </span>
              <span className="spooler-chip-label">Live</span>
              {statusCounts.live > 0 ? (
                <span className="spooler-chip-count">{statusCounts.live}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={statusFilter === "waiting"}
              className={cn(
                "spooler-chip",
                "spooler-chip-iconic",
                statusFilter === "waiting" && "spooler-chip-active",
              )}
              aria-label="Waiting"
              onClick={() => {
                const next = statusFilter === "waiting" ? "all" : "waiting";
                setStatusFilter(next);
                writeStored(STATUS_FILTER_KEY, next);
              }}
              title="Filter threads waiting for input or confirmation"
            >
              <span
                className={cn(
                  "spooler-dot spooler-dot-attention",
                  statusCounts.waiting > 0 && "spooler-dot-pulse",
                )}
              />
              <span className="spooler-chip-label">Waiting</span>
              {statusCounts.waiting > 0 ? (
                <span className="spooler-chip-count">{statusCounts.waiting}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={statusFilter === "unread"}
              className={cn(
                "spooler-chip",
                "spooler-chip-iconic",
                statusFilter === "unread" && "spooler-chip-active",
              )}
              aria-label="Unread"
              onClick={() => {
                const next = statusFilter === "unread" ? "all" : "unread";
                setStatusFilter(next);
                writeStored(STATUS_FILTER_KEY, next);
              }}
              title="Filter unread threads"
            >
              <span className="spooler-unread" />
              <span className="spooler-chip-label">Unread</span>
              {statusCounts.unread > 0 ? (
                <span className="spooler-chip-count">{statusCounts.unread}</span>
              ) : null}
            </button>
          </div>

          <SpoolerSmartViews
            activeViewId={activeViewId}
            currentQuery={query}
            currentStatusFilter={statusFilter}
            currentLifecycle={lifecycle}
            counts={{
              pinned: allRows.filter((thread) => thread.isPinned).length,
              live: statusCounts.live,
              waiting: statusCounts.waiting,
              unread: statusCounts.unread,
            }}
            onSelectView={(view) => {
              setActiveViewId(view.id);
              startSwitch(() => {
                setQuery(view.query);
                setStatusFilter(view.statusFilter);
                setLifecycle(view.lifecycle);
              });
              // "pinned" only exists as a view; a reload starts unfiltered.
              writeStored(
                STATUS_FILTER_KEY,
                view.statusFilter === "pinned" ? "all" : view.statusFilter,
              );
              writeStored(LIFECYCLE_KEY, view.lifecycle);
            }}
            onClearView={() => {
              setActiveViewId(null);
              startSwitch(() => {
                setQuery("");
                setStatusFilter("all");
                setLifecycle("active");
              });
              writeStored(STATUS_FILTER_KEY, "all");
              writeStored(LIFECYCLE_KEY, "active");
            }}
          />
          {grouping === "section" ? <SpoolerNewSection compact /> : null}
        </div>
      </div>

      <div
        className={cn(
          "spooler-list-body",
          grouping === "section" && "spooler-list-sections",
          switchPending && "spooler-list-switching",
        )}
        aria-busy={switchPending || undefined}
      >
        {status === "loading" ? (
          <div className="spooler-state" role="status" aria-label="Loading threads">
            {Array.from({ length: 8 }, (_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className="spooler-skeleton" aria-hidden="true">
                <span className="spooler-skeleton-title" />
                <span className="spooler-skeleton-subtitle" />
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div className="spooler-state" role="alert">
            <div className="spooler-empty">
              <Icon name="AlertCircle" aria-hidden="true" />
              <p>Couldn’t load threads.</p>
              <p className="spooler-empty-hint">
                Check your connection — the list refreshes automatically.
              </p>
            </div>
          </div>
        ) : shownTotal === 0 && (grouping !== "section" || sections.length === 0) ? (
          <div className="spooler-state" role="status">
            <div className="spooler-empty">
              <Icon name="MessageSquare" aria-hidden="true" />
              {deferredQuery.trim() === "" ? (
                statusFilter !== "all" ? (
                  <>
                    <p>
                      No{" "}
                      {statusFilter === "live"
                        ? "live"
                        : statusFilter === "waiting"
                          ? "waiting"
                          : statusFilter === "pinned"
                            ? "pinned"
                            : "unread"}{" "}
                      threads.
                    </p>
                    <p className="spooler-empty-hint">
                      Try selecting “All” or a different status chip above.
                    </p>
                  </>
                ) : (
                  <>
                    <p>No threads yet.</p>
                    <p className="spooler-empty-hint">
                      Start one with New thread above.
                    </p>
                  </>
                )
              ) : (
                <>
                  <p>No threads match “{deferredQuery.trim()}”.</p>
                  <p className="spooler-empty-hint">
                    Try fewer words or a different filter.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {deferredQuery.trim() !== "" || statusFilter !== "all" ? (
              <p className="spooler-result-count" role="status">
                {shownTotal} of {allRows.length} threads
              </p>
            ) : null}
            {pinnedGroup ? renderGroup(pinnedGroup, false) : null}
            {grouping === "section" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(event) => {
                  const data = event.active.data.current as
                    | { threadId?: string; spoolId?: string }
                    | undefined;
                  if (typeof data?.spoolId === "string") {
                    setDraggingSpoolId(data.spoolId);
                    setDraggingThreadId(null);
                    draggingThreadIds.current = [];
                    return;
                  }
                  const id = data?.threadId;
                  setDraggingThreadId(typeof id === "string" ? id : null);
                  setDraggingSpoolId(null);
                  draggingThreadIds.current = typeof id === "string"
                    ? selectedIds.has(id)
                      ? [...selectedIds].filter((selected) => visibleThreadIds.has(selected))
                      : [id]
                    : [];
                }}
                onDragEnd={(event) => {
                  const activeData = event.active.data.current as
                    | { threadId?: string; spoolId?: string; memberIds?: string[] }
                    | undefined;
                  const target = event.over?.data.current as
                    | {
                        kind?: string;
                        spoolId?: string;
                        sectionId?: string | null;
                        threadId?: string;
                      }
                    | undefined;
                  const ids = draggingThreadIds.current;
                  draggingThreadIds.current = [];
                  setDraggingThreadId(null);
                  setDraggingSpoolId(null);
                  setRowDrop(null);
                  if (typeof activeData?.spoolId === "string") {
                    const spoolId = activeData.spoolId;
                    // Dropping a spool onto another spool card is a no-op:
                    // spools never nest, and without this guard the spool-on-
                    // spool over target would unfile every member.
                    if (target?.kind === "spool") return;
                    const sectionId = target?.sectionId;
                    moveSpoolToSection(spoolId, sectionId ?? null);
                    return;
                  }
                  const threadId = activeData?.threadId;
                  if (typeof threadId !== "string") return;
                  if (!target || typeof target !== "object") return;
                  if (target.kind === "spool" && typeof target.spoolId === "string") {
                    // Throw the thread (and any selected batch) onto a spool.
                    const thrownSpoolId = target.spoolId;
                    void (async () => {
                      const batch = ids.length ? ids : [threadId];
                      for (const id of batch) {
                        await spoolStore.throwOntoSpool(thrownSpoolId, id);
                      }
                    })();
                    return;
                  }
                  if (target.kind === "threaddrop" && typeof target.threadId === "string") {
                    const rowThreadId = target.threadId;
                    // Positional zones: top/bottom 30% of the row say "move to
                    // that row's section"; the middle 40% says "drop-onto" —
                    // a plain thread pair becomes a new spool, target Top.
                    const zone = rowDrop?.threadId === rowThreadId
                      ? rowDrop.zone
                      : ("onto" as const);
                    if (zone === "onto") {
                      const targetSpool = spoolIdByThreadId.get(rowThreadId);
                      const draggedSpool = spoolIdByThreadId.get(threadId);
                      // Same-spool drop-onto is a no-op: spools never nest and
                      // there is no reordering inside a spool.
                      if (threadId === rowThreadId || (draggedSpool && draggedSpool === targetSpool)) {
                        return;
                      }
                      const batch = ids.length ? ids : [threadId];
                      const extra = [
                        ...new Set(batch.filter((id) => id !== rowThreadId)),
                      ];
                      void spoolStore
                        .createSpoolFromThread(rowThreadId, {
                          extraMemberIds: extra,
                        })
                        .then(() =>
                          toast.success(
                            `Spooled ${nThreads(extra.length + 1)} into “${
                              rowById.get(rowThreadId)?.displayTitle ?? "new spool"
                            }”.`,
                          ),
                        )
                        .catch((cause: unknown) => toast.error(problem(cause)));
                      return;
                    }
                    moveThreadToSection(threadId, target.sectionId ?? null, ids.length ? ids : [threadId]);
                    return;
                  }
                  const sectionId = (target as { sectionId?: string | null }).sectionId;
                  moveThreadToSection(threadId, sectionId ?? null, ids.length ? ids : [threadId]);
                }}
                onDragOver={(event) => {
                  // Compute the positional zone while over a row droppable.
                  const over = event.over;
                  const activeData = event.active.data.current as
                    | { threadId?: string }
                    | undefined;
                  if (!activeData?.threadId || !over) {
                    setRowDrop((prev) => (prev === null ? prev : null));
                    return;
                  }
                  const overData = over.data.current as
                    | { kind?: string; threadId?: string }
                    | undefined;
                  if (overData?.kind !== "threaddrop" || typeof overData.threadId !== "string") {
                    setRowDrop((prev) => (prev === null ? prev : null));
                    return;
                  }
                  const rowThreadId = overData.threadId;
                  if (rowThreadId === activeData.threadId) {
                    setRowDrop((prev) => (prev === null ? prev : null));
                    return;
                  }
                  const rowRect = event.collisions?.find(
                    (entry) => String(entry.id) === String(over.id),
                  )?.data;
                  const draggingRect = event.active.rect.current.translated;
                  let zone: "above" | "below" | "onto";
                  const overRow = rowDrop && rowDrop.threadId === rowThreadId ? rowDrop : null;
                  if (!rowRect || !draggingRect) {
                    zone = overRow?.zone ?? "onto";
                  } else {
                    const centerY = draggingRect.top + draggingRect.height / 2;
                    const rel =
                      (centerY - rowRect.top) / Math.max(rowRect.height, 1);
                    zone = rel < 0.3 ? "above" : rel > 0.7 ? "below" : "onto";
                  }
                  setRowDrop((prev) =>
                    prev && prev.threadId === rowThreadId && prev.zone === zone
                      ? prev
                      : { threadId: rowThreadId, zone },
                  );
                }}
                onDragCancel={() => {
                  draggingThreadIds.current = [];
                  setDraggingThreadId(null);
                  setDraggingSpoolId(null);
                  setRowDrop(null);
                }}
              >
                {groups.map((group) => renderGroup(group, false, true))}
                <DragOverlay dropAnimation={null}>
                  {draggingThreadId ? (
                    <div className="spooler-thread-drag-preview">
                      <Icon name="DragDropVertical" aria-hidden="true" />
                      <span>
                        {
                          rowById.get(draggingThreadId)?.displayTitle ??
                          "Thread"
                        }
                      </span>
                    </div>
                  ) : draggingSpoolId ? (
                    <div className="spooler-group-drag-preview">
                      <span className="spooler-group-grip" aria-hidden="true">
                        <Icon name="DragDropVertical" />
                      </span>
                      <span aria-hidden="true" className="spooler-spool-emoji spooler-group-drag-icon">🧵</span>
                      <span className="spooler-group-label">
                        {spoolById.get(draggingSpoolId)?.title ?? "Spool"}
                      </span>
                      <span className="spooler-group-count">
                        {spoolById.get(draggingSpoolId)?.members.length ?? 0}
                      </span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : grouping === "project" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleGroupDragStart}
                onDragEnd={handleGroupDragEnd}
                onDragCancel={handleGroupDragCancel}
              >
                <SortableContext
                  items={groups
                    .filter((group) => group.id !== SETTLED_GROUP_ID)
                    .map((group) => group.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group) => renderGroup(group, true))}
                </SortableContext>
                <DragOverlay>
                  {activeGroup ? (
                    <div className="spooler-group-drag-preview">
                      <span className="spooler-group-grip" aria-hidden="true">
                        <Icon name="DragDropVertical" />
                      </span>
                      <Icon
                        name={
                          collapsedGroupIds.has(activeGroup.id)
                            ? "Folder"
                            : "FolderOpen"
                        }
                        aria-hidden="true"
                        className="spooler-group-drag-icon"
                      />
                      <span className="spooler-group-label">{activeGroup.label}</span>
                      {activeGroup.unread > 0 ? (
                        <span className="spooler-group-unread" aria-hidden="true">
                          <span className="spooler-unread" />
                          {activeGroup.unread}
                        </span>
                      ) : null}
                      <span className="spooler-group-count">{activeGroup.total}</span>
                      <span className="spooler-group-new-thread-preview" aria-hidden="true">
                        <Icon name="MessageSquarePlus" />
                      </span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              groups.map((group) => renderGroup(group, false))
            )}
          </>
        )}
        {status === "ready" && experimental_archived?.hasNextPage ? (
          <div className="spooler-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={experimental_archived.isFetchingNextPage}
              onClick={() => {
                experimental_archived.fetchNextPage().catch(() => {
                  toast.error("Couldn’t load more threads.");
                });
              }}
            >
              {experimental_archived.isFetchingNextPage
                ? "Loading…"
                : experimental_archived.isFetchNextPageError
                  ? "Retry loading more"
                  : "Show more"}
            </Button>
          </div>
        ) : null}
      </div>

      {groupMenu ? (
        <SpoolerMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={
            groupMenu.section && groupMenu.stage === "colors"
              ? [
                  {
                    kind: "header" as const,
                    label: `Color: ${groupMenu.section.name}`,
                  },
                  ...SECTION_COLOR_OPTIONS.map((option) => ({
                    kind: "item" as const,
                    id: `color:${option.id}`,
                    label: option.label,
                    swatch: colorSwatchFor(option, isDark),
                    checked:
                      sectionColorOption(
                        sectionColorMap,
                        groupMenu.section?.id ?? null,
                      )?.id === option.id,
                  })),
                  { kind: "separator" as const },
                  {
                    kind: "item" as const,
                    id: "color:none",
                    label: "No color",
                    icon: "Ban",
                    checked:
                      sectionColorOption(
                        sectionColorMap,
                        groupMenu.section?.id ?? null,
                      ) === null,
                  },
                ]
              : [
                  {
                    kind: "item",
                    id: "expand-all-groups",
                    label: "Expand all folders",
                    icon: "Expand",
                  },
                  {
                    kind: "item",
                    id: "collapse-all-groups",
                    label: "Collapse all folders",
                    icon: "Collapse",
                  },
                  ...(groupMenu.section
                    ? [
                        { kind: "separator" as const },
                        {
                          kind: "item" as const,
                          id: "rename-section",
                          label: "Rename section…",
                          icon: "Edit",
                        },
                        {
                          kind: "item" as const,
                          id: "change-color",
                          label: "Change color…",
                          icon: "Palette",
                        },
                      ]
                    : []),
                  ...(projectOrder.length > 0
                    ? [
                        { kind: "separator" as const },
                        {
                          kind: "item" as const,
                          id: "reset-project-order",
                          label: "Reset project order",
                          icon: "ArrowReloadHorizontal",
                        },
                      ]
                    : []),
                ]
          }
          onSelect={(id) => {
            const section = groupMenu.section;
            if (section && id.startsWith("color:")) {
              // Second stage: every choice is a color; then retint + close.
              const colorId = id.slice("color:".length);
              applySectionColor(section.id, colorId);
              setGroupMenu(null);
              if (colorId === SECTION_COLOR_NONE) {
                toast.success("Section color cleared");
              } else {
                const found = SECTION_COLOR_OPTIONS.find(
                  (option) => option.id === colorId,
                );
                toast.success(`Section color set: ${found?.label ?? colorId}`);
              }
              return;
            }
            setGroupMenu(null);
            if (id === "expand-all-groups") {
              expandAllGroups();
            } else if (id === "collapse-all-groups") {
              collapseAllGroups();
            } else if (id === "rename-section" && section) {
              setRenamingSectionId(`section:${section.id}`);
            } else if (id === "change-color" && section) {
              // Two-stage menu: swap in the swatch list at the same spot.
              setGroupMenu({ ...groupMenu, stage: "colors" });
            } else if (id === "reset-project-order") {
              try {
                localStorage.removeItem(PROJECT_ORDER_KEY);
              } catch {
                // Ignore storage failure.
              }
              setProjectOrder([]);
              toast.success("Project order reset to default");
            }
          }}
          onClose={() => setGroupMenu(null)}
        />
      ) : null}

      {spoolMenu && spoolById.has(spoolMenu.spoolId) ? (
        <SpoolerMenu
          x={spoolMenu.x}
          y={spoolMenu.y}
          items={[
            {
              kind: "item",
              id: "open-top",
              label: "Open top thread",
              icon: "🧵",
            },
            { kind: "separator" },
            { kind: "header", label: "Move all to section" },
            ...sections.map(
              (section): SpoolerMenuItem => ({
                kind: "item",
                id: `spool-section:${section.id}`,
                label: section.name,
                icon: "Folder",
                checked:
                  spoolMenuSectionOf(spoolMenu.spoolId) === section.id,
              }),
            ),
            {
              kind: "item",
              id: "spool-section-none",
              label: "No section",
              icon: "Folder",
            },
            { kind: "separator" },
            {
              kind: "item",
              id: "spool-archive",
              label: "Archive Spool Threads",
              icon: "Archive",
            },
            {
              kind: "item",
              id: "spool-unspool",
              label: "Unspool threads…",
              icon: "ListCollapse",
              danger: true,
            },
          ]}
          onSelect={(id) => {
            const spoolId = spoolMenu.spoolId;
            setSpoolMenu(null);
            if (id === "open-top") {
              const lead = spoolById.get(spoolId)?.leadThreadId;
              if (lead) {
                actions.open(lead);
                onNavigate();
              }
            } else if (id === "spool-section-none") {
              moveSpoolToSection(spoolId, null);
            } else if (id.startsWith("spool-section:")) {
              moveSpoolToSection(spoolId, id.slice("spool-section:".length));
            } else if (id === "spool-archive") {
              archiveSpool(spoolId);
            } else if (id === "spool-unspool") {
              requestUnspool(spoolId);
            }
          }}
          onClose={() => setSpoolMenu(null)}
        />
      ) : null}

      {spoolNavOpen ? (
        <SpoolerMenu
          x={spoolNavOpen.x}
          y={spoolNavOpen.y}
          items={[
            ...spoolStore.spools.flatMap((spool): SpoolerMenuItem[] => [
              {
                kind: "header",
                label: `${spool.title} · ${spool.members.length}`,
              },
              ...spool.members.map(
                (memberId): SpoolerMenuItem => ({
                  kind: "item",
                  id: `spoolnav:${memberId}`,
                  label:
                    rowById.get(memberId)?.displayTitle ??
                    "(inactive thread)",
                  icon: memberId === spool.leadThreadId ? "MessageSquare" : "Submenu",
                  checked: memberId === spool.leadThreadId,
                }),
              ),
            ]),
            ...(spoolStore.spools.length === 0
              ? ([{ kind: "header", label: "No spools yet" }] as SpoolerMenuItem[])
              : []),
          ]}
          onSelect={(id) => {
            setSpoolNavOpen(null);
            if (!id.startsWith("spoolnav:")) return;
            actions.open(id.slice("spoolnav:".length));
            onNavigate();
          }}
          onClose={() => setSpoolNavOpen(null)}
        />
      ) : null}

      {menu && menuThread ? (
        <ThreadActionBridge thread={menuThread} registry={threadActionRegistry} />
      ) : null}

      {menu && menuThread ? (
        <SpoolerMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {unspoolConfirmId && spoolById.has(unspoolConfirmId) ? (
        <UnspoolConfirmDialog
          title={spoolById.get(unspoolConfirmId)?.title ?? "Spool"}
          count={spoolById.get(unspoolConfirmId)?.members.length ?? 0}
          onConfirm={() => {
            const spoolId = unspoolConfirmId;
            setUnspoolConfirmId(null);
            unspoolSpool(spoolId);
          }}
          onCancel={() => setUnspoolConfirmId(null)}
        />
      ) : null}

      {paletteIntent && rowById.has(paletteIntent.threadId) ? (
        <PaletteOverlay
          intent={paletteIntent}
          threads={threads}
          sections={sections}
          spools={spoolStore.spools}
          loading={spoolStore.status !== "ready"}
          onMove={paletteMoveToSection}
          onThrow={paletteThrowOntoSpool}
          onClose={() => setPaletteIntent(null)}
        />
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="spooler-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="spooler-bulk-summary">
            <span className="spooler-bulk-count">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              className="spooler-bulk-clear"
              title="Deselect all (Esc)"
              aria-label="Deselect all"
              onClick={() => setSelectedIds(new Set())}
            >
              <Icon name="X" aria-hidden="true" />
            </button>
          </div>
          <div className="spooler-bulk-actions">
            <button
              type="button"
              className="spooler-bulk-btn"
              title="Archive selected (E)"
              onClick={handleBulkArchive}
            >
              <Icon name="Archive" aria-hidden="true" />
              <span>Archive</span>
            </button>
            <button
              type="button"
              className="spooler-bulk-btn"
              title="Pin / Unpin selected (P)"
              onClick={handleBulkPin}
            >
              <Icon name="Pin" aria-hidden="true" />
              <span>Pin</span>
            </button>
            <button
              type="button"
              className="spooler-bulk-btn"
              title="Mark selected as read"
              onClick={handleBulkMarkRead}
            >
              <Icon name="MailOpen" aria-hidden="true" />
              <span>Read</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
