A thread list you can read at a glance, for BB.

## What you get

- A **Spooler thread list** in the left sidebar. Threads group by Today,
  Yesterday, Previous 7 days, Previous 30 days or Older, keyed off real
  activity rather than when you last opened them, so merely reading a thread
  never floats it to the top. Group by project or by section instead with one
  toggle, and reorder projects by dragging them.
- **Attention states you cannot miss.** Working, needs-you, failed and
  finished-but-unread each get their own lead glyph, word or pill on a single
  title line plus one meta line (status word, project, pull request). Status
  is never colour-only: the glyph's shape and the word both carry it, and
  unseen rows keep an ink unread dot and a bolded title. Motion is reserved
  for things that need action — the needs-you dot pulses, the working spinner
  spins — so movement always means something.
- **Nested families.** Child threads sit under their parent with indent
  guides, and a family sorts by its freshest activity. Fold one and the
  summary tells you how many are hidden, how many are unseen, and the loudest
  state inside.
- **Details on demand.** Every thread box is its own details header —
  provider icon · status glyph · title over provider name · time, with the
  pull-request chip and the project right-justified — and the chevron
  appends the rest flush beneath its tube: goal at small type in three
  clamped lines, model · effort, branch with copy, pull request, replies,
  the thread's tag and its full last-activity time, and a context meter
  that never renders empty, with Open and Split at the foot. A setting
  chooses how much the summary itself carries ("Show more information"
  or "Show minimal"). Selecting only paints the header wash; no on-hover
  peek card.
- **Thread Tags, read through.** With VladPolet's Thread Tags plugin
  installed, every row wears its thread's badge and each spool card rolls
  its members' tags up onto the title bar (distinct, attention-first,
  top four plus +N). The settings page carries the same Plugin health
  readout the Personas page shows, with a one-click install while the
  plugin is missing. Spools never edits tags — assignments stay in
  Thread Tags' own flows.
- **For working fast.** Status filter chips (All · Needs you · Failed ·
  Working · Unread), smart views in the header's View menu, a text filter,
  comfortable or compact density, keyboard traversal with quick archive and
  pin, multi-select bulk actions, and menu-only filing — **Move to section**
  in a row's ⋯ menu, right-click or touch press-and-hold.
- **A sidebar that reads like bb-app's own.** Flat rows on the plain
  sidebar with bb's rounded hover tubes, one-line caption headers whose pills
  only appear when a count is above zero, stock depth indents and family
  guides. Section identity is icon-only (per-section icons; one Section
  Settings modal with auto-save for name and icon), and the whole stylesheet
  paints with bb's own tokens — no literal colours anywhere.
- **An Active deck** (off via its setting, on by default): a pinned caption
  in section view that duplicates every running thread above the list —
  caption and cards pinned together while you scroll, headers beneath them —
  and it folds like any other group. The originals never move out of their
  own sections or spools.
- **A filter header that folds.** A chevron beside the search bar (right
  collapsed, down expanded) collapses the filter area to one line that keeps
  only the Grouping widget — the filter field folds away first; `/` from the
  collapsed state re-opens it focused.

## How it works

The plugin is frontend-only. It reads BB's live sidebar state and routes every
mutation through BB's own flows, so pins, archives and deletions behave exactly
as they do in the stock list, and nothing about your threads changes — only how
the sidebar presents them. It makes no network requests of its own, keeps no
database, and stores no secrets.

Pick it under **Settings → Appearance → Sidebar**; choosing BB there, or
disabling the plugin, restores the stock list immediately. Navigation stays on
BB's own rail. Requires BB 0.46 or later.

Two limits worth knowing: it will not move a thread between projects, because
BB's thread API exposes no project on update, and it shows model and thinking
only while a thread is actually running, because the options endpoint resolves
defaults rather than history.

## For agents

The bundled skill documents the groups, filters, folding, badges, menus,
settings and storage keys, so an agent can explain or troubleshoot the sidebar
without guessing at internals.
