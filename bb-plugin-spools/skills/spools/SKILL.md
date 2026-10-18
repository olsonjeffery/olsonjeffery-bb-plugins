---
name: spools
description: Use the Spools plugin's thread list. Use when the user asks about the sidebar's groups, filters, pins, sections, spools, the `bb spools` CLI, or how to switch back to BB's list.
---

# Spools

Replaces BB's sidebar thread list. The list itself is UI in the BB app; thread mutations go
through BB's own flows (pins, reads, renames, archives, deletes), spool membership is
plugin metadata on each thread, and a `bb spools` CLI can organise sections and spools
without opening the app.

## Surfaces

- **Thread list** (`experimental_threadList`, id `spooler`): pinned threads,
  then Today / Yesterday / Previous 7 days / Previous 30 days / Older — or
  group by project, or by **section** for drag-to-organise. The header holds
  a text filter, an Active / Archived / All switch, grouping + expand-all +
  density toggles, status chips, and the smart-views bar (New thread is
  BB's own, above the list, so the list keeps no duplicate). Preferences
  persist per client in `localStorage` (`spools:*:v1` keys).
## Navigation

BB 0.46 retired the `experimental_sidebarNavigation` slot. BB's own navigation
rail now holds Home, plugins and the user's chosen destinations, and plugins
cannot replace it, so Spooler 0.5.3 ships no navigation or rail. The `railNav`
and `wideRail` settings are gone. On BB 0.44 or 0.45, Spooler 0.5.2 still has
both.

## Organisation tools

- **Grouping modes** (`Clock` / `Folder` / `Hash` icons): time,
  project, or section. Project groups are drag-reorderable by their header
  (order persisted in `spools:project-order:v1`; right-click a header
  to reset). Each project header also carries a New-thread-in-project button.
  In section grouping only the chevron stays on the header's left; the hash
  glyph, title, live-status spinner and a count **pip** right-align in the
  meta. The pip's background matches the inner panels and the spinner —
  when threads are running — overlays it centered in the section's accent
  (`--spooler-sec-accent` from `sectionColorVars`: darker than the pastel in
  light theme, lighter than the deep tone in dark; plain sections fall back
  to `--primary`).
- **Create a section**: switch to section grouping, choose **New section**,
  enter its name and submit with **Create section** or Enter. Cancel or Escape
  closes the form without creating anything. Names are trimmed; blank names
  are rejected. Creation uses `sdk.threadSections.create({ name })`, with
  duplicate submissions blocked while pending and inline API errors that keep
  the name for retry. BB's realtime sidebar state supplies the new section;
  empty sections stay visible even with no threads or no filter matches.
- **Drag to file**: in section grouping, hover a root thread to reveal its
  grip, then drag it onto a section header (or **Unfiled**) to set its
  `sectionId` through BB's own thread update — the drop target highlights,
  the thread's own section is marked as a no-op, and a toast confirms.
  Dragging a selected thread files the whole selection. For keyboard filing,
  focus the grip, press Space, move with arrow keys, and press Enter to drop
  or Escape to cancel.
  Threads cannot be moved between *projects*: BB's update API has no
  `projectId` field, so project grouping is view-only.
- **Smart views** (`SpoolerSmartViews.tsx`): the bar under the filters offers a
  Pinned preset plus any saved view. Configure query + status chip +
  lifecycle, hit **Save view**, name it — stored in
  `spools:smart-views:v1`. Click a pill to apply (click again to
  clear).
- **Hover preview** (`SpoolerHoverCard.tsx`): pausing on a row opens a portal'd
  card (portaled because row `content-visibility` containment would clip a
  fixed-position child) with an arrow pointing at the row. Sections: title +
  provider + status word + time; the initial goal; chips for model, thinking,
  section, project, host; branch (click to copy) and PR (click to open);
  a **stacked context meter** built from `threads.context` snapshot
  categories (used / reserved / deferred, with a legend of the four biggest)
  plus a marker at the auto-compaction threshold; folded-family names; and
  Open / Split / Pin / Archive actions. It is interactive, so it stays open
  while pointed at. **The context section is omitted entirely when BB records
  no usage** (a thread that never ran a turn) rather than showing a zeroed
  bar. Placement is measured in a pre-paint layout effect: the card prefers
  the row's right, flips left when that would overflow, and clamps to an 8px
  viewport inset on both axes, so no part of it can leave the screen; the
  arrow tracks the row's mid-height even after the card is nudged. It
  measures `offsetWidth`/`offsetHeight` (not `getBoundingClientRect`) so the
  entrance `scale()` can't skew the maths, and re-places when the context
  section arrives and changes its height.

## Thread spools

**Spools gather child threads under one card.** A spool is a first-class card in section
grouping only (other groupings keep ordinary rows), stored entirely in per-thread plugin
metadata (pluginId `spools`; keys `spool`, `spoolJoined`, `spoolLead`, `spoolTitle` served
by the spool's *lead* thread). Details:

- The card shows the derived title (`Spool: <lead title>` until it is renamed — renaming
  writes `spoolTitle` to the lead; clearing the title brings the derived one back) and a
  member count (when the collapsed line cannot fit the
  working-count word it stands down to spinner + count — measured pre-paint, the
  word returns when room does — and the badge tooltip keeps the detail); a hover
  peek lists members with coloured status
  pips (gray idle / blue needs-you / amber question / red failed / green success; working
  pips breathe unless `prefers-reduced-motion`).
- Spools behave like families for sorting and navigation: open the lead via the card's
  Layers icon, jump to members, and the header layer dropdown lists every spool and
  its members for one-click navigation.
- Drag & drop: dragging a card onto a section re-files **every member** to that section;
  dragging a thread *onto another thread* (drop onto the middle 40% of a row; the outer
  bands are the ordinary above/below filing) creates a new spool from the pair (a drag
  with a selection sweeps the selection in).
- Right-click affordances: one **Spools** menu section (a separator + header) holds it
  all — threads gain *Create spool from this thread* or, for members, *Remove from
  spool* followed by the *throw onto spool* targets (⏵); cards gain open-lead /
  move-all-to-section / archive / **unspool**. Archive drops a single member's
  membership silently; unspooling every thread is destructive-looking and asks behind
  a confirm dialog (`roles=alertdialog`) every time.
- Quick palette (Mod+Shift+P): *Spools: move thread to section…* and *Spools: throw
  thread onto spool…* open side-panel pickers that mirror the drag semantics (spool
  members travel together).
- Add position: the plugin's declarative **Behavior when adding thread to spool**
  setting (main Settings container, under Swipe left) decides where a new arrival
  lands. Default is *Add to bottom of spool* — members sort oldest-first by
  `spoolJoined` like a work queue. *Add to top of spool* writes a **negative**
  stamp `-Date.now()`: it out-sorts every positive-stamp member immediately, and
  successive top adds get ever more negative stamps so each new arrival stays above
  the last (ties fall back to thread id). No sorting code knows the setting exists.
- Settings → Installed plugins → **Spools** gains a *Sections & spools* card: the section
  editor (rename / delete with inline confirm, create; **Unfiled pinned read-only**;
  counts refresh from the server) plus a spools accordion with member lists and an
  Unspool… (always with confirm dialog) action.

### CLI

`bb spools` mirrors the semantics so scripts can do the same moves (spool ids may be
written with or without their `spool_` prefix):

- `bb spools list [--json]` — every visible thread with its section, family and spool
  membership, name-resolved.
- `bb spools mv-section <thread> <section> | none` — file a thread at a section by
  name (ambiguous names error; `none` unfiles).
- `bb spools mv-spool <thread> <target> | new [--title <title>]` — throw a thread onto
  an existing spool (moving the whole spool to the target's section when you address a
  member), or `new` to start one from the thread.

## Selecting it

Settings → Appearance → **Sidebar**. Choosing BB there restores the stock
list; disabling this plugin falls back to BB's list automatically.

## Row behaviour

- Status visual: spinning green loader = thread working; distinct pulsing
  green icons for background agent (bot), background command (terminal),
  workflow, goal (target), and plan mode (checklist); amber dot =
  needs input / message waiting to send, red X icon = error / failed send,
  green check-circle = finished but unseen. Rows that need you are the
  loudest: waiting-for-input gets an amber wash + bar + glow pulse, failed
  gets the red equivalents — both stay until resolved, whether read or
  not. Finished-unseen gets the green wash + bar + semibold title + blue
  pip, clearing once opened. Auto-resolving queued states keep just the
  dot/pulse. Motion is reserved for action items (off under
  prefers-reduced-motion); finished-unseen and everything else stays
  static. Drafts show no status dot
  (the pencil badge covers them). Unknown indicators draw nothing
  (forward-compatible), and the row's accessible name appends the host's
  status label.
- Row lead: just the provider icon (14px, hard-capped).
- Right-side badges, in order: status visual (spinner, dot, or icon) plus
  its explicit word (WORKING, AGENT, COMMAND, WORKFLOW, GOAL, PLAN,
  NEEDS YOU, QUEUED, FAILED, DONE — coloured to match), jump shortcut
  while the app command modifier is held (only rows on screen get one:
  rows in a folded family or collapsed group are skipped), another
  plugin's row status (takes the draft slot, as BB's list does), amber pip
  for an unsent composer draft, blue pip for unread.
- State changes animate: washes fade, badges pop in, quiet rows fold
  smoothly, and groups + families expand/collapse with an animated roll
  (rows stay mounted only while the fold closes, hidden from keyboard and
  screen readers, then unmount so a folded group or family costs nothing;
  all off under prefers-reduced-motion).
  Threads flipping from live work to done get a one-time springy
  check-pop on their status badge.
- Adaptive rows (`adaptiveCollapse`): quiet read-idle rows fold only the
  SECONDARY chips (model, thinking, section, host) — time, project, branch,
  PR, and a folded-family summary always stay, so the metadata grid never
  reads as empty. Anything worth a glance (unread, working, needs-you,
  failed, drafts, plugin statuses, PRs needing attention, unknown states)
  keeps the full row. Editing never collapses.
- Compact density compresses **vertically only** — inline padding and the
  child indent stay identical to comfortable so tree guides keep lining up;
  the grid holds one unwrapped line (time + project + PR; the secondary
  chips and the branch yield). **Two-line titles** also applies to compact
  density and the forced-compact touch layout.
  It uses `margin-block` rather than `margin`, since the shorthand also
  zeroes `margin-left` and wipes `.spooler-row-child` / `.spooler-row-deep`.
  `css.test.ts` guards both as static assertions (jsdom does not resolve the
  real cascade).
- Pinned rows carry a small pin marker at the start of the title, so
  pinned children nested under unpinned parents stay recognisable (and
  `pinned` joins the row's accessible name).
- Hover cards (`hoverCard`): pausing on a row (hover-capable pointers only)
  opens the interactive preview described under **Hover preview**. It
  closes on leave, scroll, window blur, or when a menu opens.
- Responsive: container-query width tiers shed load as the sidebar
  narrows (status words first, then project chips, then badges down to
  status + unread); status chips fold to glyph and count at 284px or less,
  keeping their accessible labels; compact touch viewports pin the ⋯ menu inline since
  hover doesn't exist there, and filters wrap.
- Row layout: two columns. The LEFT column spans the row's full height and
  centers its content — the provider icon (or the fold/grip chevron) — so
  tall rows keep the icon mid-line instead of pinning it top-left.
  The RIGHT column is the content: the title line (title + the right-edge
  status cluster: WORKING/spinner/agent/etc, plugin row status, draft pip,
  unread pip), then ONE wrapping metadata grid.
- The metadata grid: time (leftmost, muted tabular), project chip in the
  project's own muted hue (stable per project id, readable light and dark —
  hidden only when it would echo the project group header), then model +
  thinking (outlined chips, live threads only), section chip in the
  section's own muted hue, host (away-from-home only), branch, and PR —
  every kind an outlined chip with its own max-width (default 45%, branch
  60%, folded summary 100%, time 90px, project 110px, model 130px). The
  grid WRAPS onto further lines when values don't fit; kinds never stack
  on disjointed lines. Groups, sorting, and timestamps all key off
  activity — live threads (executing, background work, queued messages,
  waiting on you) count as now, everything else keys off latest attention —
  so merely opening a thread never floats it to Today.
- Model + thinking: **shown only while the thread is in flight**
  (`isLiveThread`): `threads.defaultExecutionOptions` resolves *defaults*,
  so it answers with a model and reasoning level for any thread at all —
  including idle and never-started ones. Idle rows skip the fetch and show
  no chips. The provider name is not echoed (the icon says it) unless no
  icon is available; `Off` thinking and the home host (whichever host runs
  the most threads) are omitted as noise. Model names resolve through each
  provider's catalog; a shimmer stub holds the place while loading. The
  full text is always in the tooltip. Model info refreshes when a thread
  starts a new run, records newer activity, or the window regains focus;
  regrouping within the same run reuses cached values.
- Branch + PR live in the grid: a branch chip (a git-folder icon for
  worktrees, a branch icon for plain checkouts, click to copy, with
  `(worktree)` in the tooltip) and a PR badge whenever the thread HAS one —
  branch or not (`#123 · Open`, coloured by attention: red for failed
  checks/conflicts, amber for changes requested/blocked, blue for review
  pending, green for ready/merged). Clicking the badge opens the PR.
- Folded families swap the live chips for an inline summary of who's hidden
  (stacked people faces + remainder, names in the tooltip) — the summary
  joins the grid as a full-width item beside section/host/branch/PR.

- Hover actions: pin, rename (pencil), archive/unarchive, and a menu (⋯).
  They never resize the row and sit at the row's top right in every layout
  (over the title line's end, clear of the metadata grid so the PR badge
  stays clickable).
  Right-click opens the fuller menu: open in split, pin, mark read/unread,
  mark family read (whole tree, for threads with parents or children —
  a child's completion lands as the parent's own notification turn, so
  clearing one often means clearing both), rename, move to section,
  archive/unarchive, copy link, delete (host confirmation).
- Double-click a row to rename inline; Enter commits, Escape cancels.
- Child threads nest directly under their parent (indented, person icon,
  deeper indent past one level, VS Code-style indent guides with stubs on
  last children), and child activity bubbles up: a family
  groups/sorts by its freshest activity, so an active child floats its
  parent. Children show model • thinking + time only — no branch line, no
  echoed context (the tooltip keeps everything). Placement follows the
  root's pin state; orphans whose parent is hidden promote to roots.
  Filtering keeps matching branches plus their ancestor context. Families
  fold via the gutter chevron (persisted per client; group headers stick
  while scrolling; filtering forces everything open). A collapsed
  parent swaps its subtitle
  for an inline
  summary of who's folded (stacked people faces + remainder, names in
  the tooltip), keeps its branch line, and shows a pill
  only when the fold hides unseen threads (blue count) or loud states
  (red failed, amber needs-you, pulsing green live rollup dot). Group
  counts/rollups always include folded members and count each thread. Failed
  work takes priority over input waits, which take priority over running work.
- Hidden helper threads (`isHidden`) are filtered out, as in BB's list.

## Keyboard and selection

- `/` focuses the text filter. In the filter, ↓ moves to the first row,
  Enter opens it, and Escape clears the query (or leaves the field when it
  is already empty).
- ↑ / ↓ walk the rows, Enter opens, and Space, ← or → fold or unfold a
  family. E archives and P pins or unpins the focused row.
- These shortcuts stay out of text fields, open dialogs and menus, and
  buttons or links outside the list, and never apply to a key another handler already consumed or one held
  with ⌘, Ctrl or Alt. The focused row (or the last one reached with ↑ / ↓)
  is the target.
- X toggles the focused row into the selection (⇧ adds the range).
  ⌘- or Ctrl-click does the same with the mouse; ⇧-click adds the range
  from the last selected row. A bulk bar then offers Archive, Pin and Read,
  and E and P act on the whole selection. Selection only ever holds rows the
  list still shows: filtering one out deselects it.
- Escape clears the selection first, then the focused row, then the query.

## Settings

`bb plugin config spools`, or Settings → Installed plugins → Spools
Sidebar. The frontend reads them through `useSettings()`, and every value
has a default, so the list never waits on them. Until they load,
`defaultDensity` and `twoLineTitles` use the value this client last saw, so
rows paint at their final height.

| Key | Default | Effect |
| --- | --- | --- |
| `hoverCard` | `true` | Show the hover peek card. |
| `celebrate` | `true` | Pop the check badge once when a thread finishes. |
| `motion` | `true` | Pulse rows that need input or have failed; off under `prefers-reduced-motion` regardless. |
| `loudUnread` | `true` | Wash and accent bar on finished-but-unseen rows; off keeps the icon and pip only. |
| `adaptiveCollapse` | `true` | Fold quiet read-idle rows to their title line. |
| `defaultDensity` | `comfortable` | `comfortable` or `compact`, until the header toggle is used; that choice is remembered per client. |
| `twoLineTitles` | `false` | Enable to wrap long titles, including mentions, in both densities; metadata wraps below when needed. |
| `swipeActions` | `true` | Swipe a row left or right to act on it, by touch or with two fingers on a trackpad. |
| `swipeRight` | `Mark read / unread` | Rightward swipe action: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` or `Nothing`. |
| `swipeLeft` | `Archive / unarchive` | Leftward swipe action, same options. |

## Rules

- Never edit `localStorage` or `bb.db` to change sidebar state; use the UI.
- The list renders no virtualisation: very large thread counts (thousands)
  may scroll slowly on low-end machines. Prefer the text filter or Archived
  separation in that case.
- `app.css` is custom CSS against BB theme tokens; Tailwind utilities in
  `components/spooler/*.tsx` compile in the plugin build. Keep new styles
  behind the `spooler-` prefix.
