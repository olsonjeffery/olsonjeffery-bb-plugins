# Changelog

All notable changes to Spools are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

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
