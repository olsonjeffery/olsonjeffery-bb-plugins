---
name: personas
description: "BB Personas settings and operating constraints: the prompt pool, the Plugin health section, the Floating Notes availability flag, and how to develop the plugin."
---

# Personas

Personas gives each persona its own name, a color, a pool of prompts, a
provider, a model, and a reasoning level. Persona chats are ordinary BB
threads; each thread receives the persona's joined prompt pool as instructions
on every turn.

## Persona colors

- A persona's avatar tint is its chosen color (`PERSONA_COLORS` in
  `personas.ts`: blue, emerald, amber, violet, rose, cyan), or the stable
  hash-derived tint (`tintFor`) when the choice is null ("Auto").
- The palette rides in the icon chooser (`EmojiPicker` gets `color` /
  `onColorChange`); picking a color never closes the chooser, and the pick
  autosaves like every other field via `savePersona`'s `color` patch key.
- The color flows into every avatar the persona renders (rail, editor, home)
  through `avatarTint(personaId, color)` / `personaColorTint`. No BB host
  surface colors threads by user choice today (`bb thread update` /
  sections / tabs expose no color, and the installed tinted-threads tints by
  status only), so the avatar tint is the full extent of the flow; if a host
  thread-coloring surface appears, `persona.color` is the value to feed it.

## The prompt pool

- A persona's standing instructions are prompts in its pool (the
  `persona_prompts` SQLite table). Each prompt is tied to exactly one
  persona; deleting the persona deletes its pool.
- Prompt types are extensible (`PROMPT_TYPES` in `personas.ts`): `text`
  carries its own prose, and `note` is a live Floating Note reference. Any
  unrecognized stored type reads as `text`; a `note` row whose body is no
  longer a decodable reference degrades the same way.
- Each prompt holds up to 3500 characters (`MAX_PROMPT_TEXT`). Pool entries
  in the editor display the first 50 characters plus an ellipsis on
  overflow (`PROMPT_PREVIEW_LIMIT`).
- Every prompt has its own durable id (`prompt_<uuid>`) independent of its
  display text. There is no uniqueness rule — duplicates, including two
  entries pointing at the same note, are the user's to make and remove.
- The joined pool text is injected into every turn of the persona's chats
  (`renderPersonaInstructions`), clamped to BB's 4096-character
  instruction-contribution limit when the pool outgrows it.
- Databases from before the pool carry each persona's legacy single
  `instructions` column into one text prompt on the next start — once per
  persona, idempotent across restarts.

## Note prompts (live Floating Note references)

- Attaching a note (editor "+ Add" dropdown → "Add Floating Note") adds a
  prompt of type `note` whose stored `text` is a JSON reference
  (`encodeNotePromptRef`: `{"kind":"floating-note","noteId":…}`) to the
  note's durable id — never a copy of the note's body.
- The server keeps a live map of note bodies (`refreshNoteBodies`), read
  from Floating Notes via `bb.sdk.plugins.callRpc` (listNotes, view
  "active", limit 500). Refreshes run: on attach, on `getPersona` /
  `listRail` / `startChat` when a pool holds a note prompt, and on a 60s
  background sweep (`refresh-note-prompts`) that no-ops while no pool holds
  one and never blanks the cache on failure.
- The wire never leaks the blob: `toWirePrompt` sends note prompts with
  `text` = the note's current body (or `[Floating note is unavailable]`)
  and `noteId` carrying the link. `contributeInstructions` resolves through
  the cache the same way.
- Note entries render badged ("Floating Note") in the editor and are only
  removable — `updatePersonaPrompt` rejects them server-side; remove and
  re-attach instead.

## The persona chip (R5 flow)

Chatting as a persona starts from the **New Thread composer's persona
button**, not from any persona page:

- `app.composer.customize` registers ONE customization id
  `persona-inline-action`, scoped `["new-thread"]`, with one action
  (`PersonaInlineAction` in `components/PersonaComposerPicker.tsx`: the robot
  icon button — always the robot; the chip IS the state, so `aria-pressed` is
  the only reflection) and one popup (`personas-picker`,
  `PersonaPickerPopup`). The robot glyph also registers app-wide as
  `personas/robot` via `app.experimental_icons.register` — the panel's
  branding icon and the action share it.
- Picking a persona from the popup inserts or replaces THE persona
  @-mention pill in the draft:
  `{provider: "personas" (MENTION_PROVIDER_ID), id: <personaId>, label: pillLabel(persona)}`
  — emoji + name, trailing the typed text (never a paragraph of its own).
  One at a time (`stripPersonaPills` from `components/persona-pill.ts` runs
  before every insert), removable (the popup's "No persona — remove the
  chip" row, or deleting the mention like any editor token), and the user's
  typed text is never rewritten.
- Arming an otherwise-empty draft (`pillAddedText` blank) inserts the
  Default User Message as text after the chip — the settings-first
  replacement of the old composer-view seed.
- The pill travels with the submitted message. On the SERVER:
  `bb.ui.registerMentionProvider("personas")` answers the ordinary @-menu too
  (published personas, `displayName` needle search) and resolves the pill's
  agent context at send time — a short identity line, never the pool
  (`contributeInstructions` still injects the pool per turn, so a resolve()
  that echoed it would double it); a deleted persona resolves to a benign
  one-liner instead of throwing (which would block the send).
- `bb.experimental_hooks.on("message.dispatch")` binds the thread: the first
  `start-turn` whose input blocks carry one of this plugin's pills
  (`personaIdFromDispatchBlocks` in `personas.ts` — duck-typed so core-owned
  shapes are trusted minimally) writes the persona_threads row + in-memory
  map once and announces, exactly like the old startChat did. Draft or
  deleted personas map to nothing; every pass of the same thread is
  idempotent. `startChat` and its composer-request schema are GONE — the
  binding moved into the hook, and it now works from ANY message carrying a
  pill, whenever it was typed from.

## The Thread Info chip (R6)

`app.slots.experimental_threadHeaderAction` (`"persona-chip"`,
`PersonaThreadChip` in `components/PersonaThreadChip.tsx`) renders a chip in
the thread header's action row on EVERY thread: the mapped persona's avatar
(emoji + color tint) and name (name hidden at compact viewports — the row is
short, per the slot's contract), `title` "Chatting as <name> — open persona
settings", one click into that persona's settings page. Unmapped threads
render nothing. The lookup is the `getPersonaForThread` RPC (the same
mapping contributeInstructions reads) run through `useQuery`, so the
plugin's "personas" announce refreshes renames/colors without a remount.
The chat's own text is untouched: bb's agent-visible prompt inputs parse
agent-only blocks away, so the chip stays display-only.

## Settings-first persona page

Clicking a persona in the rail lands in its **settings** (`PersonaEditor`,
route `<personaId>/edit`; legacy routes `<personaId>` and `<personaId>/new`
parse to the same editor). There is NO per-persona composer page anymore:
the pane carries a back affordance on compact viewports and renders the
whole editor — name, icon, color, prompt pool, provider, model, reasoning,
project, Default User Message — every field autosaving as changed
(`savePersona`'s field-diffing patch; spinner + "Saving…" then "Saved ✓"
while in flight). The old "Done" button is GONE (R1): flushing is unmount
timing like any other autosave field. The persona's chat history lives at
the BOTTOM of the same pane ("Chats (n)" plus a collapsible "Archived (n)",
same `ChatRow` menus as before; the empty state points at the New Thread
composer's persona button). Publish (draft-only) and Delete (both behind
the same confirmation dialog) are the pane's only status buttons.

Wherever a chat is working — a chat-list row and its persona's rail row
alike — a green spinning glyph (`RunningSpinner`: BB's Spinner icon in
`text-emerald-600 dark:text-emerald-400`) replaces the relative timestamp
(`isThreadRunning`: execution status "starting", "active", or "stopping";
unknown status reads idle; a missing sidebar thread and archived rows never
spin).

Opening a chat (row click) navigates to BB's real thread route
(`navigate.toThread`) — the host's right side panel only attaches to the
main thread view, never to a `ThreadChat` embedded in a plugin panel.
`<personaId>/<threadId>` still renders the embedded `PersonaChatView` for
old deep links.

## Settings

**Settings → Installed plugins → Personas** shows two sections:

**Plugin health** with:

- **Install source** — the top row names where this install came from
  (`self` on the getPluginHealth RPC). A `path:` source renders as a local
  in-progress build ("Personas vX — in-progress build"); every other source
  (`git:`, `npm:`, `builtin:`, catalog) is a managed install and shows its
  raw source string.
- **Floating Notes** — a green check when it is installed and enabled, a red
  X when it is not, plus an inline **Install** link to its bb plugin page
  (<https://github.com/vburojevic/bb-plugin-floating-notes>) while missing.
- Rows read fresh from the installed-plugin list on every visit; installs,
  enables, and disables are reflected on the next open.

**Export & import** (`DataSection`, the `personas-data` settings slot) moves
personas between BB instances:

- **Export** (`exportPersonas` RPC) returns one object per persona — drafts
  included — as a top-level JSON array, downloaded as `personas.json`. Each
  object carries `format: "bb-plugin-personas/v1"`, name, emoji, the chosen
  avatar color (or null = auto tint), status, provider/model/reasoning,
  Default User Message, and the prompts: text prompts verbatim, note prompts
  as both the note's CURRENT body (verbatim snapshot, so the file is
  self-contained) and the durable `noteId` for re-linking. No ids, no
  timestamps, no chat mappings, and `projectId` exports as null.
- **Import** (`importPersonas` RPC) is additive and collision-safe: fresh
  persona/prompt ids, prompt order preserved (`position` = array index), and
  a taken name imports as "Name (NEW-IMPORT)", numbering up
  (NEW-IMPORT-2, …) with `uniqueImportName`. Nothing is ever overwritten;
  the taken-name set also includes earlier personas of the same batch.
- Per-persona fault isolation: validation happens per entry inside the
  handler (the contract's input schema is deliberately `unknown` per entry),
  so one malformed persona skips only itself and the batch reports
  `{ imported, skipped, errors }`. The section card renders the report —
  counts and per-index reasons on success, "Couldn't import: …" for a
  non-array or unparseable file.
- Status rule: the source persona's `published` survives only when the file
  also carries a provider and model (`draftBlockers` empty); anything else
  lands as a reviewable draft.
- Note re-linking: the batch lists Floating Notes' active notes once; a
  prompt whose `noteId` exists here re-attaches as a live note prompt (fresh
  body over the snapshot), one that doesn't degrades to its verbatim
  snapshot text. Floating Notes absent → every note prompt becomes text; the
  import never fails because of it.

## Operating constraints

- Requires bb `>=0.39.0` and bbPluginSdk `>=0.4.8`.
- No secrets, no plugin-level settings; all persona data lives in the
  plugin's own SQLite database inside bb's data directory.
- A plugin counts as available only when it is installed, enabled, and not in
  a hard-failure status (`disabled`, `missing`, `error`, `incompatible`).
  The server-side availability check (`isFloatingNotesAvailable` in
  `plugin-health.ts`), the source-picker gate, and the settings row share
  this one rule.
- Floating Notes missing degrades quietly: the + Add dropdown never renders
  (so no Add-note affordance appears in the persona config screen), existing
  note prompts display and inject "[Floating note is unavailable]" instead of
  crashing, and the background note sweep just no-ops.
- Deleting a persona never deletes its chats; they just stop receiving the
  persona's prompts.

## Development

```sh
npm test             # vitest: server (fake host) + app (jsdom slot tests)
npm run typecheck    # tsc --noEmit
bb plugin build      # dist bundle before install or release
bb plugin dev        # watch: rebuild and reload on every save
bb plugin logs personas -f
```
