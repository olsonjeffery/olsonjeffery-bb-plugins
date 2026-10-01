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

## Live-edit detail view

Clicking a persona in the rail lands directly in its live editor — the
detail view and the settings screen are one page. Every field (name, icon,
color, prompt pool, provider, model, reasoning, project) autosaves on change
(`savePersona`'s field-diffing patch); while a save is in flight the header
shows a spinner plus "Saving…", then "Saved ✓". A published persona's
"Done" button flushes the pending save and moves to its new-chat page. There
is no gear/settings button anywhere on a persona; the ⋯ menu offers only
New chat and Delete persona.

## Settings

**Settings → Installed plugins → Personas** shows a **Plugin health**
section with:

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
