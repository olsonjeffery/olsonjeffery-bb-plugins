# bb-plugin-draft-stack

A stack of composer drafts for [bb](https://github.com/get-bb/bb): push text,
@-mention pills, and uploaded attachments from any composer, and pop them back
into any composer later.

## Surfaces

| Surface | What it does |
| --- | --- |
| Composer inline action (hand-and-pencil glyph) | Raises the Draft Stack Select popup: a hover/keyboard-navigable list of the stack, halo on the highlighted row in your bb icon color, top of the stack pre-highlighted. Picking a row pops it into the composer. The popup attaches to the message box — it prefers the space above (falls to below only when the top can't fit its height), sits flush with the composer border (no doubled line, the facing edge squared), and scrolls within its own clamped max-height so it never covers the composer. |
| Command palette | `Draft Stack: Raise DSS`, `…: Push to stack`, `…: Pop from stack` (composer commands — listed when a composer would run them). |
| Settings page | The stack, top first: drag and keyboard reordering, per-entry delete, downloadable attachment links, clear-all, and an arbitrary raw-JSON rewrite. |
| `bb draft-stack` CLI | `list`, `push <text>`, `pop`, `remove <id>`, `clear` — with `--json`. |

Pop semantics are uniform: remove an entry from the stack, then overwrite the
composer's draft with it (text, mention pills, attachments restored verbatim,
mention ranges still matching the text).

## Behavior notes

- The stack is a single persisted JSON array in the plugin's SQLite database;
  array order is the stack order, last entry = top. Arbitrary content
  (quotes, emoji, newlines, code) needs no escaping work — JSON round-trips
  everything.
- Pushes are capped at 100 entries and 200k characters per draft; pushing
  beyond the cap drops the oldest (bottom) entries.
- Picking a row in the selector pops it — the popup is the main
  pop-from-anywhere path; removal otherwise happens in settings.
- Attachments are already-uploaded files: their paths belong to the project
  the composer was in, so the settings page links them through that project's
  attachment content endpoint when the scope is known.
- The selector's highlighted row (hover and keyboard) wears a halo in the
  color picked under bb's Appearance → icon color.

## Development

```
cd bb-plugin-draft-stack
bb plugin install .          # register the checkout in place
bb plugin dev                # rebuild + reload on every save
npm test                     # vitest: shared model + popup/settings slabs
bb draft-stack list          # the CLI, running live
```

- `server.ts` — storage (one-row SQLite), the RPC contract, the CLI.
- `draft-stack.ts` — shared stack model, caps, lenient rewrite sanitizing.
- `app.tsx` — registrations: icon, composer action + popup, commands,
  settings section.
- `components/` — the popup, the settings page, hooks, the glyph.
