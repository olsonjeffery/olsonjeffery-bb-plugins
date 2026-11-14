---
name: spools
description: Use the Spools plugin's thread list. Use when the user asks about the sidebar's groups, filters, pins, sections, spools, the `bb spools` CLI, or how to switch back to BB's list.
---

# Spools

Replaces BB's sidebar thread list. The list itself is UI in the BB app; thread mutations go
through BB's own flows (pins, reads, renames, archives, deletes), spool membership is
plugin metadata on each thread, and a `bb spools` CLI can organise sections and spools
without opening the app.

The list reads at a glance and inspects on demand: every row answers three
questions in one line — does this need me, what is it, when did it change —
and everything else sits behind the row's permanent ⋯ menu or its inline
Details panel, which is ALWAYS open for the selected thread. Surfaces follow the approved `docs/glance-redesign-mockup`
reference.

## Surfaces

- **Thread list** (`experimental_threadList`, id `spooler`): pinned threads,
  then Today / Yesterday / Previous 7 days / Previous 30 days / Older — or
  group by project, or by **section** to organise with the ⋯ menu
  (New thread is BB's own, above the list, so the list keeps no duplicate).
- **Filter header**, three rows. Row A: the search input (with the `/`
  keycap; `/` focuses it) and the collapse chevron. Row B: the
  Active / Archived / All switch, the grouping toggle, and the ⋯ **View
  menu**. Row C: the **status chips**, a wrapping row (never a horizontal
  scroll or a container fold).
  The header collapses to ONE line — the chevron at the search bar's right
  edge (right glyph when collapsed, down when expanded) hides the status
  chips row and every control but the Grouping widget (Section / Time /
  Project); collapsed, that widget anchors the row's left edge and the
  chevron sits right-justified, and <kbd>/</kbd> expands the header and
  focuses the field; persisted in `spooler-sidebar:filters-collapsed:v1`;
  default expanded. Section view adds the fixed **Active deck** (below).
  What lives in the **View menu (⋯)**: smart views (the Pinned preset,
  saved views, Save view), the density choice (Comfortable / Compact),
  Expand-All / Collapse-All folders, and **Jump to spool…** (the member
  navigation dropdown listing every spool and its members). Section
  grouping keeps **New section** under the chips.
- **Status chips** (`role=radiogroup`): **All · Needs you · Failed ·
  Working · Unread**, each with its count. Needs you carries an amber dot
  and takes its attention surface when the count is above zero; Failed
  carries a red dot and takes its destructive surface; Working carries a
  success spinner; Unread carries the ink dot. Selected uses
  `aria-checked` and bb's `bg-state-active` wash. The stored filter ids
  are still `live`/`waiting` (labels only renamed); `failed` is new, and
  stored preferences keep working with no migration.
- **Groups**, time / project / section: caption rows — chevron, marker
  icon (section's chosen icon; project's folder; pinned's pin), label,
  quiet total — with **attention pills only while the group is FOLDED**
  (shared `AttentionPills` lane; expanded, the group's own rows carry the
  attention and the caption would say every state twice): "N failed" on
  the destructive surface, "N needs you" on the attention surface with
  its pulsing amber dot, "N working" as success text with a spinner —
  each pill only when its count is above zero. Section identity is
  **icon-only**: colour dots, hue vars and colour pickers are gone;
  stored colour values are ignored, not migrated.

## Navigation

BB 0.46 retired the `experimental_sidebarNavigation` slot. BB's own navigation
rail now holds Home, plugins and the user's chosen destinations, and plugins
cannot replace it, so Spooler 0.5.3 ships no navigation or rail. The `railNav`
and `wideRail` settings are gone. On BB 0.44 or 0.45, Spooler 0.5.2 still has
both.

## Row anatomy

Every thread box IS its details' header — the same two-line content runs
collapsed and expanded, so the outer row never duplicates the panel:

- **Main line**: the **provider icon** rides the tree gutter (the slot a
  drag grip used to fade in), overlapping any guide and never hiding it;
  the **16px lead** carries the status glyph — a success spinner (working,
  incl. working-draft), pulsing glyphs for background agent / command /
  workflow / goal / plan, an amber needs-you dot, a red ✕, a green done
  check — or the family fold chevron; selection replaces the lead with
  its checkbox. Then the **title, truncating to ONE line** (the wrap
  grammar retired — a wrapped title pushed the trailing chrome into the
  margin), the unread ink dot, the jump-shortcut keycap, another plugin's
  row-status icon, the unsent-draft pip, and the two fixed controls at the
  right edge: the **permanent ⋯** and the **details chevron**.
- **Sub-head**: left — the status word or pill (canonical "Working[ ·
  kind]" in success text; "Needs you" / "Queued" amber pills; "Failed"
  red; done shows none), the **provider name**, and the **short time**
  ("now", "12m", "2h" — the full relative text is the tooltip and still
  re-renders on the minute tick); right — the folded-family rollup ("N
  replies · ● loudest"), the **pull-request chip** (`#N` in its tone;
  the full label is the tooltip and lives in the details), the thread's
  **tag badge** (Thread Tags, when that plugin is live — see Integration),
  an **away-host chip** (the details Host rule), and the
  **project, right-justified** with a hairline pivot (truncates first).
  Quiet rows (adaptive collapse) drop the PR chip; idle threads have no
  status slot at all.
- **Summary depth (`threadSummary`)**, the plugin setting, shapes this
  sub-head without the details panel: ***Show more information*** (the
  default) keeps every slot above, including the tag badge and the
  away-host chip; ***Show minimal*** keeps the status glyph + word/pill,
  the short time, and the tag badge only — the provider name, PR chip,
  replies-rollup TEXT and the project chip yield the line to the title,
  the attention family rollup (failed / needs-you) still shows, and
  quiet rows fold to title + time.

## Details (always open), the ⋯ menu

- **Permanent ⋯**: threads carry it in the title line, just left of the
  short time; spool cards carry it left of the "Spool" label and the count
  pip (the pip is a count again, no longer the actions trigger). The ⋯ is
  the row's only menu affordance — there is no hover cluster — and spool
  glyphs show fully at rest (no hover swap any more). The ⋯ joins the tab
  order only while its row holds focus (the row is the roving tab stop).
- **Three ways to open the same menu**: click the ⋯, right-click the row
  (or a spool header), or **press-and-hold** on touch/pen (~450ms, cancel
  on an 8px move; the follow-up tap is swallowed so the touch that opened
  the menu never navigates). Mouse keeps right-click.
- **Context menu order** (threads): Open in split · Pin/Unpin · read /
  unread (+ family read) · Rename… · **Archive** · **Delete…** (danger) ·
  a **Spools** block (create, or for members move-to-top / release / throw
  targets) · a **Move to section** block · Copy link last. Renames still
  work inline via double-click.
- The menu clamps into the viewport from its MEASURED height: the top
  shifts upward so the whole menu stays in view; it scrolls internally
  only when even that cannot fit the viewport at all.
- **Inline Details panel** (`SpoolerThreadDetails.tsx`): the chevron opens
  it FLUSH beneath the header tube — a full-width hairline separator, the
  definition list, then the Open (primary) / Split footer. It carries no
  header of its own and no Status/Provider/Section rows: the row's header
  carries provider, status and time, and the sidebar carries the section.
  Facts: Goal (tail-size type, THREE clamped lines), Model · effort
  (ALWAYS — the options endpoint resolves defaults for idle threads
  too), Host (only away from the home host), **Tag** (the thread's one
  Thread Tags badge, when the other plugin is live), **Activity** (the
  full relative time — the sub-head's short form reads it only as a
  hover tooltip, which touch cannot), Branch (copy), Pull request,
  Replies, and the **context meter** — never empty: a base fill from
  used/token-window always paints (2px floor), tone categories overlay
  only when they account for the usage they claim, and the auto-compact
  tick rides it. Per-row disclosure: several boxes can be open; selection
  NEVER opens a panel (the selected tone paints the header tube only, and
  the washes retarget to the tube so tones layer vertically, never
  squeezed into a two-tone side strip). The row root gains
  `spooler-row-open` when a panel is out.
- **Fetches**: context usage lazily per row from the single cache; the
  execution options fire only while a panel is open, so idle lists never
  pay for the model catalog.
- The on-hover peek card is RETIRED (component and setting gone; hovering
  rows paints nothing but the hover tube).

## Active deck

- **Active deck** (`SpoolerActiveDeck.tsx`): a fixed, optional card
  (plugin setting **Active deck**, default on) in section grouping only —
  the hardcoded deck above Pinned and Inbox, inside the pinned
  `spooler-active-station`: the station pins the caption AND its card row
  together at the scrollport's top for the whole scroll, and every other
  group header's sticky top is offset by the station's measured height
  (`--spooler-active-overlap`, ResizeObserver-tracked). The caption reads
  "Active" + a count pip overlaying a running spinner (failed dot /
  needs-you dot override); it folds like any other group (chevron at the
  right, aria-expanded, persisted in the ordinary group-collapse set as id
  `active`), filtering forces it open, and View-menu Expand/Collapse-All
  reach it. Each member is a duplicate card — status glyph, truncated
  title, home label (the spool's title with its SpoolIcon glyph, else the
  section name, else "Inbox") — clicking opens the thread while the
  original stays in its own section and/or spool card (deck members are
  not lifted; the deck never enters `shownTotal`). Ordering is failed >
  needs-you > running.

## Organisation tools

- **Grouping modes**: time, project, or section. Project groups are
  drag-reorderable by their header (order persisted in
  `spools:project-order:v1`; right-click a header to reset; each header
  carries a New-thread-in-project button). Section grouping keeps the flat
  stock rows on the plain sidebar, rounded accent hover tubes, caption
  headers, stock depth indents — section rows one step off the bucket edge
  with one straight guide at the section-icon axis; spool rosters one step
  deeper still under one continuous guide. Unspooled thread titles may
  wrap to two rows before ellipsizing.
- **Section Settings**: the header context menu offers a single
  **Section settings…** entry (double-click the section title too) opening
  a modal with auto-save — name saves on a short debounce via
  `sdk.threadSections.update`, the icon saves the moment it is picked; ONE
  status slot beside Done reports Saving…/Saved/error. Cancel discards
  uncommitted drafts; Done flushes and closes. The colour row is gone.
  Styles persist in `spooler-sidebar:section-style:v2` as a per-section
  record that keeps **only its icon** (curated builtin set or any pasted
  emoji/unicode character; stored `color` fields are ignored rather than
  migrated), shared with the plugin-settings section editor (name, create,
  delete — no swatches) through the same event bus.
- **Create a section**: switch to section grouping, choose **New section**,
  enter its name and submit with **Create section** or Enter. Cancel or Escape
  closes the form without creating anything. Names are trimmed; blank names
  are rejected. Creation uses `sdk.threadSections.create({ name })`, with
  duplicate submissions blocked while pending and inline API errors that keep
  the name for retry. BB's realtime sidebar state supplies the new section;
  empty sections stay visible even with no threads or no filter matches.
- **File through the menu** (drag is retired): a row's ⋯ → the **Move to
  section** block files it at a section (or **No section** → the unfiled
  **Inbox** bucket that leads the section list), through BB's own thread
  update; the current section carries a checkmark, and a toast confirms.
  A member's move re-files the whole spool (the lead leads).
  Threads cannot be moved between *projects*: BB's update API has no
  `projectId` field, so project grouping is view-only.
- **Smart views** (in the View menu): a Pinned preset plus any saved view.
  Configure query + status chip + lifecycle, hit **Save view**, name it —
  stored in `spools:smart-views:v1` with the same status ids as the chips
  (`failed` accepted). Pick a view to apply it (pick again to clear).
- **Row context menu** (⋯ click, right-click, or press-and-hold): Open in
  split, pin, mark read/unread, mark family read (whole tree), rename,
  **archive**, **delete…** (order: right below Rename, in the top block),
  the Spools block (for members: Move to top above Remove from spool), the
  Move-to-section block, then Copy link. Delete routes the host's
  confirmation.

## Thread spools

**Spools gather child threads under one label.** A spool is a first-class entry in section
grouping only (other groupings keep ordinary rows): the SpoolIcon glyph owns the icon
rail (there is no grip — dragging retired), the title sits above one muted meta line
reading **"Spool · N working"**, and the trailing cluster reads ⋯ · label · count pip
(the pip is a passive count now). While the roster is folded, the caption carries the
SAME **AttentionPills** lane the section caption uses — "N failed" / "N needs you"
(pulsing amber dot), no working pill (the meta line + pip spinner own that count);
expanded, the lane drops and the member rows carry the attention. Membership is stored
entirely in per-thread plugin metadata
(pluginId `spools`; keys `spool`, `spoolJoined`, `spoolLead`, `spoolTitle` served
by the spool's *lead* thread). Details:

- The card shows a FROZEN title, named ONCE at creation (`Spool: <lead title>` at that
  moment, or the user-supplied name) and written into `spoolTitle` on the lead — later
  adds, the lead thread's own renames, and lead handovers never re-derive it; renaming
  the spool replaces the frozen value, and clearing the name re-freezes the currently
  derived title at that moment (nothing returns to live derivation). Spools created
  before titles froze keep their live-derived name until the first add to them, which
  locks the name exactly as it shows — and also persists an elected lead's `spoolLead`
  so the arrival's join stamp can never re-elect a different lead. Lead migration
  (archive/release) persists the promoted member's `spoolLead` too, and never promotes
  a member whose family leaves together with the old lead. The card also shows the
  member count pip (working members spin the success spinner behind the numeral; the
  pip takes the state-active surface). Between the title and that cluster the card
  also shows the **rolled-up member tags**: the roster's DISTINCT Thread Tags as
  priority items — deduped, ordered by the wearers' attention (failed > needs-you >
  unread > working > idle), then wearer count, then tag label — capped at four with a
  `+N` overflow chip whose tooltip lists the rest; each badge's tooltip names how many
  of N members wear it. The spool header carries no project/branch/PR chips any more —
  those are member-row facts, in Details.
- Member rows are flat: they hang one stock depth step deeper than the bucket's own
  rows (a shared left edge), carry one straight roster guide instead of tree
  elbows, and no person glyph. Every member still renders at depth 1 for its row
  logic (no branch or section chip).
- Spools behave like families for sorting and navigation: open the lead via the
  card's glyph, jump to members, and the View menu's **Jump to spool…** lists
  every spool and its members for one-click navigation.
- Menu affordances: the card's ⋯ opens the **spool menu** (open lead /
  move-all-to-section / archive-spool-threads / **unspool**); thread menus
  carry the **Spools** block — *Create spool from this thread* or, for
  members, *Move to top* then *Remove from spool* followed by the
  throw-onto-spool targets. *Move to top* promotes the member (+ its
  in-spool family, order preserved) to the head of the roster by rewriting
  only `spoolJoined` — a fresh `-Date.now()` top stamp that out-sorts every
  existing member while the lead role and the frozen title stay untouched.
  Filing or throwing works from the menu, right-click, or press-and-hold.
  Archive drops a single member's membership silently; unspooling every
  thread is destructive-looking and asks behind a confirm dialog
  (`roles=alertdialog`) every time.
- Quick palette (Mod+Shift+P): *Spools: move thread to section…* and *Spools: throw
  thread onto spool…* open side-panel pickers that mirror the menu semantics (spool
  members travel together).
- Add position: the plugin's declarative **Behavior when adding thread to spool**
  setting (main Settings container, under Swipe left) decides where a new arrival
  lands. Default is *Add to bottom of spool* — members sort oldest-first by
  `spoolJoined` like a work queue. *Add to top of spool* writes a **negative**
  stamp `-Date.now()`: it out-sorts every positive-stamp member immediately, and
  successive top adds get ever more negative stamps so each new arrival stays above
  the last (ties fall back to thread id). No sorting code knows the setting exists.
- Settings → Installed plugins → **Spools** gains a *Sections & spools* page: the section
  editor (rename / delete with inline confirm, create; **Inbox pinned read-only**;
  counts refresh from the server) and NO spool list — the sidebar's spool cards own
  membership management. It also lists the **Plugin health** block (the Thread Tags
  readout, see Integration) above the section editor.

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

## Thread Tags integration

When VladPolet's `bb-plugin-thread-tags` is installed and enabled, spool
rows wear the thread's one tag and spool cards roll their members' tags
up onto the title bar (deduped, attention-first, top four + `+N`); the
details panel gains a Tag line item. The integration is READ-ONLY —
assignments stay in Thread Tags' own flows (its row button, its settings
page, `bb thread-tags`); Spools never sets, creates or deletes tags.

- The sidebar reads the tag state through `sdk.plugins.callRpc`
  (`state_get`), refreshed on Thread Tags' `tags-changed` realtime
  channel, on bb's `plugins-changed`, and on reconnect; availability is
  the installed-plugin row itself (present, enabled, not disabled/missing/error/incompatible/starting).
- Everything degrades quietly when the plugin is missing: no badges, no
  spinner, the one extra failed probe at most.
- The spool title bar's rollup derives from the members the spool already
  renders — threads the list does not show (archived, filtered) never
  contribute badges.
- Settings → Installed plugins → **Spools** gains a **Plugin health**
  card — the same Thread Tags readout the Personas settings page shows:
  a green check when the plugin runs (state + version: `Running ·
  v0.1.0`), a red X otherwise ("Not installed" / "Installed — disabled"),
  and a one-click **Install This Plugin** while missing (pinned source
  `git:…@semver:^0.1.0`, bare URL fallback), re-reading bb's
  `plugins-changed` and the next reconnect.

## Selecting it

Settings → Appearance → **Sidebar**. Choosing BB there restores the stock
list; disabling this plugin falls back to BB's list automatically.

## Row behaviour

- Status is never colour-only: the lead glyph's shape and the meta line's
  word or pill both carry it. Auto-resolving queued states keep the amber
  pulse. Drafts show no status glyph (the pip covers them). Unknown
  indicators draw nothing (forward-compatible), and the row's accessible
  name appends the host's status label.
- **Touch & compact viewports** (`docs/viewport-gap-analysis-2026-11-10`):
  under `(hover: none)` no hover paint sticks — row tubes, group + spool
  headers, chips, segmented buttons and the row chrome release to their
  resting look after a tap, and the per-header + new thread affordance
  shows at rest; under `(pointer: coarse)` the header chrome grows to
  touch scale (chips and segmented 30px, 34px search row, 16px filter
  ink — no iOS focus zoom) and the row/spool ⋯ chrome gains hit area.
  `isCompactViewport` still forces the compact density; the desktop list
  and the mobile drawer share every data behavior (press-and-hold menus,
  swipes, adaptive collapse). Bottom-sheet menus remain the top open
  item in the analysis doc.
- Time: `timeShort` — "now", "12m", "2h", "2d", then a short date. Same
  minute granularity as the full text at the bottom of the scale, so the
  label flips within the same minute tick. The full text is always in the
  tooltip and in Details.
- State changes animate: pills appear, badges pop in, quiet rows fold
  smoothly, and groups + families expand/collapse with an animated roll
  (rows stay mounted only while the fold closes, hidden from keyboard and
  screen readers, then unmount so a folded group or family costs nothing;
  all off under prefers-reduced-motion). Threads flipping from live work
  to done get a one-time springy pop on the lead's check glyph.
- Adaptive rows (`adaptiveCollapse`): quiet read-idle rows are title +
  project + time — no status word, no PR on the meta line. Anything worth
  a glance (unread, working, needs-you, failed, drafts, plugin statuses,
  PRs needing attention, unknown states) keeps the full row. Editing never
  collapses.
- Compact density compresses **vertically only** — inline padding and the
  child indent stay identical to comfortable so tree guides keep lining
  up; the meta line truncates to one unwrapped line.
  It uses `margin-block` rather than `margin`, since the shorthand also
  zeroes `margin-left` and wipes `.spooler-row-child` / `.spooler-row-deep`.
  `css.test.ts` guards both as static assertions (jsdom does not resolve the
  real cascade).
- Pinned rows carry a small pin marker at the start of the title, so
  pinned children nested under unpinned parents stay recognisable (and
  `pinned` joins the row's accessible name).
- Model + thinking live in Details, shown only while the thread is in
  flight (`isLiveThread`): `threads.defaultExecutionOptions` resolves
  *defaults*, so it answers with a model and reasoning level for any thread
  at all — idle rows skip the fetch and show nothing. `Off` thinking and
  the home host (whichever host runs the most threads) are omitted as
  noise; the Host row appears only away from home. Model names resolve
  through each provider's catalog; Details shows the section only when
  present, plus Provider always. Context usage refreshes lazily, once per
  row, on first Details or peek open.
- Family folding: the parent's meta line carries "N replies · ● loudest"
  (failed > needs-you > unread > working) instead of the project chip;
  count/rollups always include folded members and count each thread.
  Failed work takes priority over input waits, which take priority over
  running work.
- Hidden helper threads (`isHidden`) are filtered out, as in BB's list.
- Double-click a row to rename inline; Enter commits, Escape cancels. The
  rename row keeps the title + meta layout without the cluster.
- The stylesheet paints only with bb's host tokens (no literal colours,
  no hard-coded font sizes — the `--text-2xs/xs/sm` scale — and weights
  only 400/500/600); `css.test.ts` guards that statically.

## Keyboard and selection

- `/` focuses the text filter. In the filter, ↓ moves to the first row,
  Enter opens it, and Escape clears the query (or leaves the field when it
  is already empty).
- ↑ / ↓ walk the rows, Enter opens, and Space, ← or → fold or unfold a
  family. E archives and P pins or unpins the focused row. The row's ⋯ is
  reachable while the row holds focus: Tab steps into it (never parked on
  an invisible button of any other row), and the menu walks with ↑↓/Home/End.
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
| `celebrate` | `true` | Pop the lead's check glyph once when a thread finishes. |
| `motion` | `true` | Pulse the needs-you dot and spin the working glyph; failed rows stay still; off under `prefers-reduced-motion` regardless. |
| `loudUnread` | `true` | Bold title on finished-but-unseen rows. Off means no bold title, and the ink unread dot still shows. |
| `threadSummary` | `more` | `more` — Show more information: the full sub-head (tag badge and away-host chip included) — or `minimal` — Show minimal: status, short time and tag badge only. Shapes the thread box, never the details panel. |
| `adaptiveCollapse` | `true` | Fold quiet read-idle rows to title, project and time. |
| `activeDeck` | `true` | Show the fixed Active deck in Group By Section (default on). |
| `defaultDensity` | `comfortable` | `comfortable` or `compact`, until the View menu choice is used; that choice is remembered per client. Compact keeps the meta line with tighter rows and single-line truncation. |
| `twoLineTitles` | `false` | Enable to wrap long titles, including mentions, in both densities; the meta line stays beneath. |
| `swipeActions` | `true` | Swipe a row left or right to act on it, by touch or with two fingers on a trackpad. |
| `swipeRight` | `Mark read / unread` | Rightward swipe action: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` or `Nothing`. |
| `swipeLeft` | `Archive / unarchive` | Leftward swipe action, same options. |

## Rules

- Never edit `localStorage` or `bb.db` to change sidebar state; use the UI.
- The list renders no virtualisation: very large thread counts (thousands)
  may scroll slowly on low-end machines. Prefer the text filter or Archived
  separation in that case.
- `app.css` is custom CSS against bb's theme tokens; Tailwind utilities in
  `components/spooler/*.tsx` compile in the plugin build. Keep new styles
  behind the `spooler-` prefix, work through the host's tokens only (no
  literal colours, `--text-*` for type, weights 400/500/600), and let
  `css.test.ts`'s static guards keep it that way.
