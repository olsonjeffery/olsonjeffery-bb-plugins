# Changelog

All notable changes to Spools are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.7.1 — 2026-10-29

### Removed
- **The spool-level hover peek card.** Pausing on a spool header no longer
  opens the portaled member-list panel (`.spooler-spool-peek`) — the
  redesigned slab shows its roster outright (expand the spool, or use the
  ✎ lead/member navigation and the header's count pip menu), so the peek is
  redundant and its hover lag + pointer bridge were noise. Thread rows keep
  their own hover preview card; the `hoverCard` setting still governs that
  one only. The member-status rollup counts and its tooltip stay on the
  spool header.

## 0.7.0 — 2026-10-29

### Changed
- **The Section display is redesigned** to the approved mock: every entry
  (section header, spool, thread) is an edge-to-edge slab on one shared
  **2px rhythm** — no rounded cards, no boxed panels, no interior gutters;
  children manage their own padding.
- **Tri-tone section color:** the header slab carries the anchor (darkest),
  spool strips mix **58%** over the sidebar, thread slabs **30%** — including
  unspooled threads in the section. The unfiled **Inbox** joins as a
  neutral-gray slab with the same derivation. Attention washes still paint
  over the tones.
- **Section headers read title-left, controls-right:** the left rail shows
  the section's chosen icon and the right group runs unread ·
  count-plus-working pill · collapse chevron **furthest right**. The old
  universal `#` glyph is retired; a section without an icon renders none.
- **Section Settings modal** (context menu `Section settings…` or
  double-click the section title) replaces the Rename/Change-color pair:
  name, color and icon with auto-save — name on a short debounce, color and
  icon the moment they are set — reported in ONE status slot beside Done
  (left-aligned). Cancel discards uncommitted drafts; Done flushes and
  closes.
- **Icons:** a curated builtin grid plus **paste in any emoji/unicode
  character** (single grapheme cluster); styles store in
  `spooler-sidebar:section-style:v2` ("`{color, icon}`" per section) with the
  v1 color map migrated on read. The plugin-settings section editor stays in
  sync through the same event bus.
- **Entry typography:** spool titles drop to weight 500 and are ALWAYS
  italic; thread titles sit a notch lower (450), upright. All-caps section
  headers keep the reviewed styling.
- **Two-row titles:** every section-mode entry title wraps to two rows
  before it ellipsizes, always outranking the detail pills, which now run in
  one wrapping flex grid under the title — pills ellipsize inside their own
  boxes (per-kind max-widths) and the grid re-flows across rows without ever
  overflowing the entry.
- **Order:** unspooled threads float to the top of a section; the spool deck
  rides beneath.
- **Rims:** section and spool header slabs carry a darkened bottom border
  (`color-mix(#000 16%)`); a spool's roster starts flush under it — no
  interior top margin, and the old roster hairlines are gone. All entry
  icons (section, spool 🧵, thread provider) share one horizontal axis; the
  spool's drag grip fades in over the 🧵 mark on hover.

### Removed
- The `--spooler-sec-accent` token (the pip spinner color is theme-fixed
  green today, so the token had no remaining consumer) and
  `--spooler-sec-bg` (superseded by `--spooler-sec-anchor`).
- The section header's inline rename editor (superseded by the modal).

## 0.6.6 — 2026-10-29

### Fixed
- **A spool is named ONCE, at creation — adds can no longer retitle the card.**
  The card name derived live from the lead thread's frontier title, so a lead
  marker that slipped away (a release without persisted election) let the next
  join — whose top stamp out-sorts every existing member — become the effective
  lead; every subsequent add then flipped the card to `Spool: <that thread>`.
  Creation now freezes the derived name (`Spool: <lead>` at that moment, or the
  user's `--title`) into `spoolTitle` on the lead, and nothing derives again:
  later adds, the lead thread's own renames, and lead handovers leave the name
  exactly as it shows. Renaming replaces the frozen value and sticks; clearing a
  rename now re-freezes the currently derived name at that moment (the title
  never returns to live derivation). Spools created before this change keep
  their current behaviour until the first add touching them, which freezes the
  name as shown and — when the lead had slipped away — persists the elected
  lead, so arrival stamps can never re-elect underneath the card.
- **Lead migration persists the promoted member.** When the lead leaves
  (archive, release), the elected next member now gets real `spoolLead`
  metadata along with the migrated title — previously only the title moved,
  leaving a lead-less spool whose effective lead re-elected by join order on
  every later add.
- **Release elects a member that actually stays.** Releasing a lead dropped its
  whole family from the spool, but the election considered only the direct
  member list — a released child could be promoted and take the migrated title
  into the exit. The remaining family is now excluded before electing.
- **`bb spools mv-spool … new` names its spool once too** — same frozen title
  semantics as the sidebar (a `--title` name still wins).

### Changed
- `deriveSpools` exposes `leadElected` (true when the lead was recovered by the
  election fallback rather than read from real `spoolLead` metadata); the add
  path reconciles it into real metadata once, idempotently.

## 0.6.5 — 2026-10-26

### Changed
- **Spool members sit flush with the roster.** Member rows lose the indent
  that set them apart from the card's own threads: the 8px row margin, the
  9px roster inset, the 16px metadata inset, and the tree guides that drew a
  family under a parent. The provider icon now starts in the same column as
  ordinary thread rows, so the threads and their metadata get the width the
  indent was eating. Family children keep their indent and guides.
- **No person glyph on threads.** The little person icon that marked a child
  thread repeated what its indent and guide already said, so it is gone
  everywhere, child rows included.

### Fixed
- **The status cluster no longer overlaps the metadata grid.** WORKING, the
  spinner, and the pips were centered on the whole row, so they landed beside
  the metadata grid's first line and could paint over a chip on it; a long PR
  chip could also spill under them. The cluster now shares the title line
  (aligned on the title's first baseline, so a wrapped title keeps it on line
  one), and the grid is pinned to the text column beneath it.

## 0.6.4 — 2026-10-24

### Fixed
- **Uniform margins around the Inbox.** The Inbox pseudo-section has no
  server sectionId, so it never carried the `spooler-group-bucket` styling:
  its content kept the legacy spool-card margins (4px top / 10px bottom) ON
  TOP of the shared 6px fold gap, while the fold's inline gutter and the
  thread-cluster margin resets applied only to real sections — its spool
  cards sat visibly roomier than the colored sections around it. The Inbox
  now counts as a section bucket for styling (same fold rhythm, same gutter,
  same zero-margin cards), while everything server-section-gated (rename,
  recolor) stays keyed on a real sectionId.

## 0.6.3 — 2026-10-24

### Changed
- **The fixed unfiled bucket is now the Inbox and leads the section list.**
  In section grouping the pseudo-section renders FIRST — above every server
  section, where freshly sent threads land — renamed from "Unfiled" to
  "Inbox" with its own inbox glyph; its group id, drop targets, the `unfiled`
  CLI keyword, and every other behavior are unchanged.

## 0.6.0 — 2026-10-17

### Changed
- **Thread rows redesigned as two columns.** Every row now has a left icon
  column that spans the row's full height and centers its provider icon
  (and the fold/grip chevron with it), beside a content column. The content
  is a title line (title + the right-edge status cluster), then ONE wrapping
  metadata grid: time, project, model + thinking (live threads only),
  section, host, branch, and PR — each an outlined chip with its own
  max-width (default 45%, branch 60%, folded-family summary 100%). Facts
  wrap onto further grid lines instead of stacking different kinds on
  disjointed ones; quiet rows fold only the secondary chips (adaptive
  collapse — time, project, branch, PR stay), and compact density keeps one
  unwrapped grid line.
- **The PR badge shows on every thread that has one**, branch or not — it no
  longer rides the branch line, so a running thread's open PR is on the
  panel even before its environment resolves.

### Fixed
- A spool card whose lead thread is unresolvable (deleted, or filtered out
  of the view) no longer renders a title-less card: the derived title falls
  back to the first member, and an empty base reads "Unnamed spool". The
  spool header's 🧵 icon and grip center across the header height when the
  badges line wraps (two-line titles), and the title button keeps a floor
  (80px, content basis) so crowded badges can never squeeze it to zero.

### Added
- **Section colors.** Right-click a section header (Group By Section) and choose
  **Change color…** to pick from an eleven-color palette (neutrals included,
  plus **No color** to clear). The tint paints the section's drawer and its
  sticky
  header, with black or white text kept for contrast; the palette supplies
  light- and dark-theme variants of every color, detected from the host theme
  at runtime. Colors live in local storage keyed by section — the server's
  section record carries only `{id, name}`. Spool cards and unspooled thread
  cards keep their own neutral panel color inside the tinted drawer.
- **Rename section.** On the same header menu: **Rename section…** opens the
  in-place editor on the title (Enter commits, Escape or empty input reverts)
  and applies through the server section record.
- **Unspooled thread cards.** Inside a section, threads that are not spooled
  now render as cards matching their spool neighbors. Spool members stay flat
  inside their spool card, separated by a subtle divider.

### Changed

- **Section grouping is the default** view and sits first (leftmost) in the
  grouping control; an explicit stored choice still wins.

## 0.5.3 - 2026-10-10

BB 0.46 retired the sidebar navigation slot that Spooler's navigation and rail
were built on. On BB 0.46, 0.5.2 can't load: its bundle registers the removed
slot, so the thread list disappears too. This release keeps the thread list
working and leaves navigation to BB's own rail.

### Removed

- Spooler's navigation above the list, the navigation rail and its labelled
  mode. BB's own rail now holds Home, plugins and your destinations, and
  plugins can no longer replace it. The **Navigation rail** (`railNav`) and
  **Labelled rail** (`wideRail`) settings and the rail's project filter over
  the list go with them.

### Changed

- Requires BB 0.46 or later. On BB 0.44 or 0.45, keep 0.5.2, which still has
  the navigation and rail.

## 0.5.2 - 2026-10-04

### Fixed

- Keep BB's sidebar toggle and the updates chips inside the navigation rail.
  The desktop toggle was offset past the rail to clear the traffic lights,
  and the updates chips wrapped out of the footer column.
- Give the updates chips a taller cell in the narrow rail. The project
  tiles keep their size. The destination list scrolls in a shorter stack
  so the footer can use the height it needs. The same separator that sits
  above the project icons also sits above Show labels and Customize.
- Keep the thread list responsive while agents run. Each sidebar update
  re-rendered every row, even when only one thread had changed. Now only
  the changed row re-renders. The minute clock now refreshes only rows
  whose time label moved.
- Unmount rows in a folded group or family once it finishes closing.
  Folded threads no longer cost rendering work or pull-request lookups.
- Stop the sidebar toggle alignment from 0.5.1 slowing down all of BB.
  Its `body:has()` rules made every DOM change restyle the whole page,
  even with the rail off. That covered each streamed chunk and each
  tooltip or menu opening. The rail now renders its overrides for BB's
  sidebar as `<style>` elements in its own markup, applied only while it
  is mounted. It no longer uses `:has()` and never writes to BB's
  elements. Computed styles are unchanged.
  In a 20,000-element benchmark, a chat update drops from about 6.8ms to
  0.35ms, and a tooltip from about 5.8ms to 2µs.
- Lighten the navigation rail. Its height reserve is now a rule scoped to
  the sidebar rather than a custom property on the page root, which cost
  a full-page restyle on every resize frame. Thread updates no longer re-render its destinations
  and project tiles unless something they show changed. Scroll updates
  for its scroll thumb run once per frame.

## 0.5.1 - 2026-10-04

### Fixed

- Align BB's sidebar toggle with the navigation rail's icon column in narrow,
  labelled and mobile layouts. The override releases when the rail is off
  or the desktop sidebar is collapsed.

## 0.5.0 - 2026-10-04

### Added

- Optional **Navigation rail** (`railNav`, default `false`) beside the Spooler
  thread list on desktop and mobile, retaining the published plugin identity
  and the existing navigation above the list when off.
- Project monogram filters, Home to show every project, desktop tooltips with
  shortcuts and tallies, keyboard traversal, and destination arrangement menus.
- Experimental **Labelled rail** (`wideRail`, default `false`), requiring
  Navigation rail and a recognised host shell. Sidebar expansion derives
  from the rail widths and preserves the thread list's room.
- Scoped host footer and Customize layouts that release on deselection,
  setting changes, Settings, and offcanvas collapse; reduced motion and
  mobile safe-area support.
- Narrow-list status chips fold at 284px, retaining accessible labels.
- CSS cascade guards and project-scope persistence/lifecycle regression tests.

### Fixed

- Home clears the project filter without creating a thread; New thread keeps
  BB's original action and does not clear the selected project.
- Turning the rail off restores every project while remembering the filter
  for later; an independently selected list offers its own clear control.
- Project tiles sort by real activity rather than read timestamps, with live
  work ahead of idle projects.
- More focuses its first enabled destination so keyboard traversal works
  immediately, in both navigation layouts.
- Entering a compact viewport clears visible and pending desktop tooltips.

## 0.4.1 - 2026-10-01

### Changed

- Large sidebars do less repeated work: date formatting and family
  traversal are cached, and requests and gesture handlers inside folds
  pause while hidden. Fold state and summaries stay reactive.

### Fixed

- The touch nav lays its icons out as a row across the top instead of a
  tall centered column, so the thread list starts near the top on phones.
  Icons wrap to a second row only when more arrive than fit.
- One-line thread titles no longer collapse to zero width on narrow rows
  with a status badge: the project chip shrinks first behind its ellipsis,
  the title keeps a 40px floor, and the time shrinks with an ellipsis
  instead of sliding under the badge.

## 0.4.0 - 2026-10-01

### Added

- **Swipe actions** (`swipeActions`, default `true`): swipe a thread row left
  or right to act on it, with one finger on a touch screen or two fingers on
  a trackpad (a Mac, or an iPad with a Magic Keyboard). Each side is
  configurable (`swipeRight`, default mark read / unread; `swipeLeft`,
  default archive / unarchive) from: mark read / unread, pin / unpin,
  archive / unarchive, open in split, rename, more actions, delete
  (host-confirmed), or nothing.
  - The row tracks the input, a colored pill grows from the edge with its
    icon growing alongside, and the icon pops when the swipe arms (a third
    of the row by touch, over half by trackpad), with a short haptic tick
    where supported. On release a spring carries the input's speed home, so
    a flick flows into the settle; a swipe that rests before release carries
    no speed. The pill keeps the label of what was done while it closes.
  - Archiving (or unarchiving from the Archived tab) slides the row away and
    folds its space before the host acts; on the All tab the row stays and
    springs back, and so does a thread with replies, whose archive the host
    confirms first.
  - Trackpads report no lift-off, so a trackpad swipe stopped short of
    arming rests open with its action as a button, as in Mail on a Mac:
    click it to act; press elsewhere, scroll or press Escape to close; move
    again to carry on. One row stays open at a time. A swipe keeps following
    after the row slides out from under the cursor, and the momentum tail
    after a release is swallowed.
  - Vertical movement stays a scroll, the host drawer does not react to a
    row swipe, releasing a swipe never opens the thread, and a mouse's
    clicks, drags and Shift+wheel are unaffected. A sideways wheel step of a
    whole notch (a tilt wheel) is left to scroll too: a trackpad eases in
    with small steps, and only that starts a swipe.
  - Opening a row by trackpad closes any other row left open, and Escape
    closes an open row without also clearing the search behind it.

### Fixed

- Jump shortcuts (⌘/Ctrl+1–9) skip rows hidden in a folded family or
  collapsed group, so the numbers follow the rows on screen. A search or
  status filter that forces a fold open numbers its rows again.

## 0.3.0 - 2026-09-30

### Added

- **Two-line titles** (`twoLineTitles`, default `false`): long thread titles,
  including mentions, wrap before truncating. Project chip and time stay
  beside short titles when they fit, or wrap below aligned with the text.
  Applies in both densities. Hover actions move to the row's last line of
  plain text, off a wrapped title and clear of the PR badge. Rows use taller
  offscreen height estimates, and the row-height settings (`defaultDensity`,
  `twoLineTitles`) are remembered per client so the first paint uses them
  before settings finish loading.
- Tests use jsdom storage explicitly so Node 26's native `localStorage`
  does not cause preference and sidebar tests to fail.

## 0.2.1 - 2026-09-29

### Fixed

- Folding groups or families clears hidden selections and keyboard targets,
  and restores focus when the focused row disappears.
- Group status prioritizes failures and input waits over running work, counts
  each descendant, and excludes queued or blocked work from running counts.
- Folded-family status describes only hidden descendants, excluding the parent.
- Mounted rows react to changes in celebration, hover-card and adaptive-collapse
  settings, and reuse unchanged provider records to preserve row memoization.
- Navigation follows BB's live order and visibility hook and delegates saves to
  host actions, removing duplicate preference fetches, races and merge logic.
- Section grip drags move the selected threads together and report partial
  failures. Keyboard section dragging works and exposes its grip to assistive
  technology while project sorting retains its own keyboard behavior.
- Archive shortcuts and bulk actions leave completion feedback to BB, which
  may require confirmation before archiving a family.
- Opening a row menu closes its hover preview and cancels pending previews.
- Time buckets use local calendar boundaries across daylight-saving changes.

## 0.2.0 - 2026-09-29

### Added

- Create sections directly in Spooler's section view with **New section**:
  inline naming, keyboard cancellation, pending-state protection and retryable
  error feedback through BB's section API.

### Changed

- Update to BB 0.44 navigation API: use host sidebar navigation hooks, split
  drag handles, and support dedicated skills panel actions.

### Fixed

- Keyboard shortcuts no longer take over the rest of BB. They stay out of
  text fields, open dialogs and menus and controls outside the list, ignore keys another handler already
  handled or that carry ⌘/Ctrl/Alt, and no longer swallow arrow keys when
  the list is empty. Enter keeps its native behaviour on links and buttons;
  Space folds a focused thread family without taking over nested buttons.
- Arrow navigation moves DOM focus with the highlight, so archive, pin and
  selection shortcuts act on the displayed target rather than a stale row.
- Mark family read includes the selected child and its descendants, not just
  its root and siblings.
- Text and status filters reveal matches inside collapsed groups without
  overwriting saved fold preferences.
- Archived pagination stays available when loaded threads do not match the
  active filters.
- Empty sections remain visible as drag-and-drop destinations, including
  when there are no threads or the current filters match nothing.
- Execution details refresh for new runs and newer activity, including rows
  returning from a filter, without stale requests overwriting the cache.
- Completion celebrations expire despite intervening thread updates and
  overlapping completions; pending timers are cleared on unmount.
- The Pinned smart view now filters to pinned threads instead of just
  resetting the filters, and "Save view" only appears when a filter is active.
- Selection is pruned to rows the list still shows, so bulk actions can no
  longer hit threads a filter has hidden. X toggles selection from the
  keyboard, and dragging a selected row now carries the whole selection.
- Bulk pin, bulk mark-read and the pin shortcut report failures instead of
  announcing success, and pin errors from the row and peek card are shown.
- Saved smart views are validated on load, so a corrupt entry no longer
  crashes the list.
- The filtered-count label no longer includes hidden helper threads.
- The preference migration is retried on the next launch when a key could not
  be moved, instead of being marked done.
- Menus: Home focuses the first item and End the last; the More popover no
  longer uses invalid menu/list roles.
- Renaming a thread is no longer overwritten when its title changes
  underneath you.
- Threads whose parents form a cycle no longer disappear from the list.
- Thread rows skip re-rendering when nothing they show changed, and the
  filter box no longer blocks typing on large lists.
- Removed about 1,600 lines of unused UI code and the unused `zod` and
  `@radix-ui/react-checkbox` dependencies.
- BB now shows the spooler icon for the plugin. `bb.branding.icon` named an icon
  BB's own set does not have, so BB fell back to its default; it now points
  at `assets/icon.svg`.

## 0.1.0 - 2026-09-28

### Added

- Activity-grouped thread list: Today / Yesterday / Previous 7 days / Previous
  30 days / Older, keyed off real activity rather than last-read time, so
  opening a thread never floats it to Today.
- Group by project or by section, with sticky headers, expand/collapse all,
  and drag-to-reorder projects.
- Nested thread families: indent guides, gutter folding, and a folded summary
  that rolls up hidden counts, unread state and the loudest hidden status.
- Attention system that separates working, needs-you, failed and
  finished-unread by icon, status word, wash, accent bar and motion; a
  one-time check pop when a thread finishes.
- Per-row provider icon, model and thinking chips (shown only while a thread
  is in flight), pull-request badges, and click-to-copy branches.
- Hover peek card with the initial goal, branch, PR and a stacked
  context-window meter with an auto-compaction marker.
- Smart views: save the current query, status filter and lifecycle as a named
  one-click preset.
- Status filter chips (all / live / waiting / unread), multi-select with bulk
  archive, pin and mark-read, full keyboard traversal, and comfortable or
  compact density.
- Navigation that follows BB's own server-synced sidebar arrangement, so
  arranging destinations in either surface carries over.
- Six settings: five that turn down the louder visuals, and a default row
  density.
- A one-time migration of preferences from the `codex-sidebar:` era.
