---
name: drawio
description: Working with .drawio diagram files that the Drawio plugin edits — where they live, how to read and write them safely alongside the human's embedded editor, and how to avoid clobbering unsaved work.
---

# Drawio diagrams

The Drawio plugin embeds a self-hosted draw.io editor in BB. Humans edit
`.drawio` files in that editor; you can read and write the same files. The
plugin is a viewer over ordinary files — it owns no separate store — so every
edit you make is visible to the editor on its next reload, and every save the
human makes lands in the same file you would write.

## Where diagrams live

1. **Docs vaults** — `.drawio` files under the plugin's folder (default
   `diagrams/`) in any vault. Read and write them exactly like any other vault
   file with `bb docs` (`bb docs read <path> --vault <vault>`,
   `bb docs write …`). Note that `bb docs list` only shows Markdown notes —
   use `bb docs sync --json` (snapshot) or `bb docs pull` to discover
   non-Markdown files.
2. **Workspaces and host paths** — any `.drawio` file in a project worktree or
   host directory. Read it with the file tools you already have.

## Rules when the human has the editor open

- **Never write blind.** The editor saves with compare-and-swap (it carries
  the sha256 it loaded). If you overwrite a file the human is editing, their
  next save comes back as a conflict and they must choose reload-or-overwrite.
  Prefer proposing changes through a Docs proposal (for `.md`) or making your
  edit, then telling the human to reload the diagram.
- **Vault writes:** use the CAS form (`bb docs` push flow, or expected sha
  where the tooling exposes it) so a concurrent human save fails loudly
  instead of being clobbered.
- **.drawio XML is mxGraph XML.** The root element is `<mxfile>`, containing
  one or more `<diagram>` elements, each with an `<mxGraphModel>` whose
  `<root>` holds `<mxCell>` elements. When you generate a diagram, emit a
  complete `<mxfile>` document. Keep `id` attributes unique per page.
- **Geometry:** cell positions live in `mxGeometry` (`x`, `y`, `width`,
  `height`); edges connect via `source`/`target` cell ids. Layout it
  deliberately — the human sees exactly the coordinates you write.

## Drafts

If the human closed the editor with unsaved work, the plugin keeps a draft in
its own storage and offers to restore it when the diagram reopens. You cannot
read drafts — don't try to reconstruct them; just tell the human the editor
will offer to restore.

## Quick reference

```sh
# discover .drawio files in a vault
bb docs sync --json | jq '.files[].remotePath' | grep -i '\.drawio$'

# read one
bb docs read diagrams/architecture.drawio --vault personal

# edit a workspace diagram
# (ordinary file tools; the editor picks it up on reload)
```
