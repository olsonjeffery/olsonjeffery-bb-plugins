---
name: draft-stack
description: Read and manage the Draft Stack plugin with the `bb draft-stack` CLI. Use when the user asks about their stacked drafts, to inspect, push, pop, remove, or clear the Draft Stack, or to review what drafts the user has saved.
---

# Draft Stack

The Draft Stack plugin keeps a stack of composer drafts: text, @-mention
pills, and uploaded attachments. Array order is the stack order — the LAST
entry is the top. Pushes append at the top; a Pop removes and returns the top.
The composer's stack button (hand-and-pencil glyph) opens the stack selector;
picking a row there pops it into the composer.

## Commands

| Command | Effect |
| --- | --- |
| `bb draft-stack list` | Show every entry, top last, with ids. |
| `bb draft-stack push <text>` | Push a text-only draft onto the stack. |
| `bb draft-stack pop` | Print and remove the top entry. |
| `bb draft-stack remove <entry-id>` | Remove one entry by id. |
| `bb draft-stack clear` | Empty the stack. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb draft-stack list` before you change the stack; never guess an id.
2. Do NOT pop entries to peek — popping removes the entry from the stack and
   the user expects it gone. Use `list --json` to read an entry's text.
3. The Draft Stack plugin's settings page in bb's UI allows reordering and
   raw-JSON rewrites; use the CLI only for what the user asked.

## Rules

- Change the stack only through `bb draft-stack` or the bb UI. Do not edit
  bb.db or the plugin's storage directly.
- A non-zero exit with "No entry with id" means the id is stale: run
  `bb draft-stack list` again.
