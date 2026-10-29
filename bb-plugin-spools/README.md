<div align="center">

<img src="docs/logo.svg" width="96" height="96" alt="Spools logo">

# Spools

### See which of your threads needs you, at a glance.

Spools replaces BB's sidebar thread list with a layout built for people
juggling dozens of agent threads at once.<br>
Grouping, folding and attention states do the sorting for you, so nothing that
needs a decision hides at the bottom of the list.

> Forked from [MacHatter1/bb-plugin-radar-sidebar](https://github.com/MacHatter1/bb-plugin-radar-sidebar)
> (MIT). The original radar sidebar is this plugin's foundation; Thread Spools
> and the renames are layered on top of it.

![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)
![bb ≥ 0.46](https://img.shields.io/badge/bb-%E2%89%A5%200.46-22d3ee)
![Plugin SDK ≥ 0.6.37](https://img.shields.io/badge/plugin%20sdk-%E2%89%A5%200.6.37-0369a1)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

[Features](#features) · [Install](#install) · [How it works](#how-it-works) · [Settings](#settings) · [Development](#development)

<br>

<img src="docs/screenshots/hero.png" alt="Spooler's thread list beside an open thread waiting for approval: two threads need input, one runs a background command, one is working and one has failed" width="900">

</div>

<br>

> [!NOTE]
> The screenshots are real BB captures populated with fictional demo data.

## The problem

You have forty agent threads open across six projects. Two are waiting for a
decision, one failed twenty minutes ago, and three finished while you were
somewhere else. BB's sidebar sorts them all the same way, so finding the ones
that need you is a manual sweep — and the moment you click a thread to look, it
jumps to the top of "Today" and you lose track of what was actually moving.

Spooler is opinionated about the difference between *recent* and *important*.
Activity decides where a thread sits, not when you last opened it. Threads that
need something from you are impossible to miss, and threads that are simply
quiet get out of the way.

|  | Without Spooler | With Spooler |
| --- | :---: | :---: |
| Tell working from finished without reading | ❌ | ✅ distinct icon, word and colour per state |
| Opening a thread changes its group | ❌ it jumps to Today | ✅ grouping keys off real activity |
| See what a collapsed family is hiding | ❌ | ✅ count, unread rollup and loudest state |
| Spot a thread waiting for your input | ❌ | ✅ amber wash, bar and slow pulse |
| Tell which provider and model a thread runs | ❌ | ✅ icon, model and thinking on the row |

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🛰️ Activity grouping

Threads group by Today, Yesterday, Previous 7 days, Previous 30 days or Older,
keyed off last *activity* — not last read. A thread you merely opened stays
where it belongs, and anything running or waiting surfaces to Today. Group by
project or section instead with one toggle. In section view, choose **New
section**, enter a name, then **Create section**. Drag threads onto its header
or use **Move to section** in a thread's right-click menu.

</td>
<td width="50%" valign="top">

### 🔴 Loud attention states

Working, needs-you, failed and finished-unread each get their own icon, status
word, colour and row treatment. Rows that need a decision wash amber or red and
breathe a slow glow; finished-but-unseen threads get a green wash, accent bar
and bold title. Motion is reserved for things that need action, so movement
always means something.

</td>
</tr>
<tr>
<td valign="top">

### 🪢 Nested families

Child threads sit under their parent with indent guides, and the family sorts by
its freshest activity, so a running child floats its parent. Fold a family and
the summary tells you how many are hidden, how many are unseen, and the loudest
state inside.

</td>
<td valign="top">

### 🔎 Hover peek card

Pause on a row for a preview with the thread's original goal, its branch and
pull request, and a stacked context-window meter marked at the auto-compaction
threshold. It is interactive, so you can pin, split or archive from the card.

</td>
</tr>
<tr>
<td valign="top" colspan="2">

### ⌨️ Keyboard and bulk control

Arrow keys walk the list, <kbd>Enter</kbd> opens, <kbd>Space</kbd> folds,
<kbd>E</kbd> archives, <kbd>P</kbd> pins and <kbd>X</kbd> selects. Shortcuts
stay out of text fields, open dialogs and menus, and buttons or links outside the
list, so they never steal keys from the rest of BB. <kbd>⌘</kbd>-click or <kbd>⇧</kbd>-click also selects several,
to act on them together from a floating dock. Save a query plus filters as a
named smart view. Swipe a row, by touch or with two fingers on a trackpad,
to mark it read or archive it; each direction's action is a setting.

</td>
</tr>
</table>

<div align="center">
<table>
<tr>
<td align="center"><img src="docs/screenshots/families.png" alt="Today group with needs-you, background-command, failed and finished rows, one expanded family and one folded family" width="440"><br><sub><b>Attention states and nested families</b></sub></td>
<td align="center"><img src="docs/screenshots/hover-card.png" alt="Peek card beside a thread running a background command, showing its goal, model, section, branch and context use" width="440"><br><sub><b>Hover peek card</b></sub></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/group-by-project.png" alt="Threads grouped under Tidewater and Lantern project headers" width="440"><br><sub><b>Grouped by project</b></sub></td>
<td align="center"><img src="docs/screenshots/group-by-section.png" alt="Threads grouped under Bugs and Research section headers" width="440"><br><sub><b>Grouped by section</b></sub></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/filters-smart-views.png" alt="Waiting status chip active beside a saved smart view named Needs me, showing 2 of 15 threads" width="440"><br><sub><b>Status chips and a saved smart view</b></sub></td>
<td align="center"><img src="docs/screenshots/bulk-select.png" alt="Three selected threads and the bulk bar with Archive, Pin and Read" width="440"><br><sub><b>Multi-select and bulk actions</b></sub></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/compact.png" alt="The same list in compact density" width="440"><br><sub><b>Compact density</b></sub></td>
<td align="center"><img src="docs/screenshots/context-menu.png" alt="Right-click menu on a thread, with its Move to section choices" width="440"><br><sub><b>Right-click menu</b></sub></td>
</tr>
</table>
</div>

## Install

```sh
bb plugin install 'git:https://github.com/olsonjeffery/olsonjeffery-bb-plugins.git@main' --yes
```

The Git semver range tracks compatible `v0.5.x` releases. If you installed
an earlier minor series, rerun this command to move to the new range.

Then pick it in **Settings → Appearance**: choose **Spools** for the sidebar.
Navigation stays on BB's own rail: BB 0.46 retired the navigation slot that
Spools' navigation and rail were built on, so 0.5.3 removes them. On BB 0.44
or 0.45, keep an earlier release, which still has them.

<details>
<summary><b>Install from a local clone</b></summary>

```sh
git clone https://github.com/olsonjeffery/olsonjeffery-bb-plugins
cd olsonjeffery-bb-plugins/bb-plugin-spools
npm install && bb plugin build
bb plugin install path:$PWD --yes
```

</details>

**Requirements**

- bb **0.46+** (Plugin SDK 0.6.37+)

## Where to find it

| Where | What |
| --- | --- |
| **Sidebar thread list** | Grouped, folded, attention-coloured threads with a filter, status chips, grouping and density toggles, and expand/collapse all. Status chips fold to glyph and count when the list is 284px or less, so the filter row stays on one line. |
| **Smart views bar** | Saved query-plus-filter presets, and a shortcut to save the current one. |
| **Row hover** | Pin, rename, archive and a fuller menu; a peek card after a short pause. |
| **Settings → Appearance** | Choose Spooler for the thread list. |

## Compatibility notes

Spools replaces only the thread list. BB 0.46 retired the sidebar navigation
slot that Spools' navigation and rail were built on, so navigation is BB's
own rail and Spools styles none of BB's elements. Nothing here touches BB's
data: thread operations go through BB's own actions and the public SDK, and
client state lives under `spools:*` localStorage keys.

## How it works

```mermaid
flowchart LR
  H[BB host sidebar hooks] --> D[pure derivation<br/>grouping · folding · filters]
  D --> R[rendered list]
  R -->|actions| A[BB host actions &amp; public SDK]
  A --> H
```

- **Reads BB's live state, owns none of it.** Threads, projects and sections
  come from the host's sidebar hooks; pins, reads, renames and archives route
  through BB's own actions, so optimistic updates, confirmations and toasts
  behave exactly as they do in the stock list.
- **Derivation stays out of the components.** Grouping, tree building and
  filter matching live in one hook, `useThreadGroups`, and time bucketing is
  a plain function with no React, so the rows only render.
- **Model info is fetched, then cached per window.** The options endpoint
  resolves *defaults*, so model and thinking are shown only while a thread is
  actually in flight. Remounts within the same run reuse cached values;
  new activity, a restart or window focus triggers a refresh.
- **It will not move a thread between projects.** BB's thread API exposes no
  `projectId` on update, so project grouping is view-only; drag-to-organise
  files threads into sections, which BB does allow.

## Privacy

- 🛰️ **Nothing leaves the machine.** Spooler makes no network requests of its own;
  every read and write goes to your BB server through the plugin SDK.
- 🧾 **No storage of its own.** No database, no files. Preferences live in
  browser `localStorage`.
- 🔒 **No secrets.** The plugin defines no secret settings and reads none.

## Settings

`bb plugin config spools`, or **Settings → Installed plugins → Spools**.

<details>
<summary><b>All settings</b></summary>

| Setting | Default | |
| --- | --- | --- |
| `hoverCard` | `true` | Show the hover preview card on thread rows. |
| `celebrate` | `true` | Pop the check badge once when a thread finishes. |
| `motion` | `true` | Pulse rows that need input or have failed. Also respects `prefers-reduced-motion`. |
| `loudUnread` | `true` | Wash and accent bar on finished-but-unseen threads. Off keeps the icon and pip only. |
| `adaptiveCollapse` | `true` | Fold quiet read-idle rows down to title, project and time. |
| `defaultDensity` | `"comfortable"` | `comfortable` or `compact`. Applies until you change density in the header, which is remembered per client. |
| `twoLineTitles` | `false` | Enable **Two-line titles** to wrap long titles, including mentions, before truncating. Short titles keep their project chip and time beside them when they fit; otherwise metadata wraps below, aligned with the title text. Applies in both densities. |
| `swipeActions` | `true` | Swipe a row left or right to act on it: one finger on a touch screen, two fingers on a trackpad. A trackpad swipe stopped short rests open with its action as a button. A mouse's clicks, drags and Shift+wheel are unaffected. |
| `swipeRight` | `"Mark read / unread"` | Action for a rightward swipe: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` (BB confirms) or `Nothing`. |
| `swipeLeft` | `"Archive / unarchive"` | Action for a leftward swipe, from the same list. |

The list never waits on settings: until they load it uses the defaults above,
except that `defaultDensity` and `twoLineTitles` use the value this client last
saw, so rows paint at their final height. In two-line mode, hover actions sit
on the row's last line of plain text (the subtitle, or the project chip and
time where the subtitle is folded away), so they stay off a wrapped title and
off the PR badge. A row that is only one line tall still has them over the end
of its title, as in one-line mode. They never change the row's layout.

</details>

<details>
<summary><b>Turning it off</b></summary>

```sh
bb plugin disable spools
bb plugin enable spools
```

`bb plugin remove spools` removes the plugin and its settings. Disabling
it returns the sidebar to BB's own list immediately.

</details>

## Development

```sh
npm install
npm test
npm run typecheck
bb plugin build
bb plugin install path:$PWD --yes
bb plugin dev                      # rebuild and reload on every save
```

```
server.ts               the settings the frontend reads; no storage, no CLI
app.tsx                 registers the thread-list slot
app.css                 styles on BB theme tokens, behind the spooler- prefix
components/spooler/       the list, rows, menus, peek card and smart views
components/spooler/*.ts   grouping hook, time bucketing, model cache
lib/swipe.ts            swipe actions and gesture math, shared with server.ts
components/storage.ts   one-time migration of codex-sidebar: preferences
components/ui/          vendored BB UI primitives
skills/                 the bundled agent skill
assets/icon.svg         the plugin icon BB shows (bb.branding.icon)
docs/                   logo and screenshots
```

**Tests** cover time bucketing as plain functions, the
rendered list through BB's plugin test harness (`renderSlot` with seeded
sidebar threads), saved-view validation, preference migration, execution-cache
refreshes, completion timers, and render counts, so a sidebar update re-renders
only the rows that changed. Static guards over `app.css` cover cascade
mistakes jsdom cannot reproduce.
The test setup uses jsdom's `localStorage` explicitly, including on Node 26,
whose native storage global otherwise shadows it without a backing file.

`PLUGIN_OVERVIEW.md` is the store listing. Keep it in step with
`bb.description` in `package.json`.

## Licence

[MIT](LICENSE)
