Stack composer drafts and pop them back into any composer, later.

## What you get

- A **stack inline action** on every composer (the hand-and-pencil glyph)
  that raises the Draft Stack Select popup above the prompt window: a
  keyboard- and hover-navigable list of stacked drafts, highlighted with a
  halo in your bb icon color.
- **Command palette actions**: raise the selector, push the current draft
  onto the stack, and pop the top entry into the composer.
- A **settings page** listing the stack (top first) with drag and keyboard
  reordering, per-entry delete, downloadable attachment links, and an
  arbitrary raw-JSON rewrite of the stack.
- A `bb draft-stack` CLI so agents can inspect and manage the stack from a
  shell.

Pushes carry the full draft: text, @-mention pills, and uploaded
attachments, stamped with the composer's project/thread scope so attachment
links still resolve.

## How it works

The stack is one JSON array in the plugin's own storage on the BB server —
the last entry is the top. Nothing leaves the machine, and the plugin needs
no account, API key, or external service.

## For agents

The bundled skill tells an agent to read the stack with `bb draft-stack
list` and to avoid popping entries unless the user asked: pops remove.
