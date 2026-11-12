# Changelog

## Unreleased

- **Docs-vault browser replaces the drawio-only file list.** Both the route's
  left sidebar and the right-panel window tab now list every file in the
  selected vault (bb's own Docs browser hides non-Markdown files); non-diagram
  files open in bb's built-in preview, diagrams in the embedded editor.
- **Delete** on every row (confirm dialog; the kept draft is discarded with
  the file; the discovery cache self-heals).
- The browser window tab is an **addable, closable action tab**
  ("Vault browser" in the panel's New-tab menu); the fixed drawio-only
  browser tab is gone.
- Vault discovery auto-refreshes after two minutes, so files created outside
  the plugin (agents, `bb docs`) appear without pressing refresh.

## 0.1.0 — the core loop

- `deploy/`: a systemd **user** unit (`drawio.service`) plus
  `setup-drawio-unit.sh` that installs/enables it for the official
  `jgraph/drawio` image on `0.0.0.0:12300` — foreground supervision under
  systemd, lingering for boot persistence, rootless-docker detection,
  readiness check, `--check`/`--dry-run`/`--uninstall` modes.

- Embedded self-hosted draw.io editor (embed + JSON postMessage protocol) with
  origin validation and mixed-content detection.
- **Diagrams** nav panel: home state (import XML, recent vault diagrams, kept
  drafts) routing to a full-bleed editor via `open/…` deep links.
- Vault persistence over the bundled Docs plugin's RPC: cached `.drawio`
  discovery (SQLite), CAS writes, conflict dialog (reload kept-draft /
  overwrite), new-diagram creation into the configured vault + folder.
- Workspace & host persistence via the `fileOpener`: any `.drawio` file BB
  opens loads and CAS-saves through `bb.sdk.files`.
- One action tab per open diagram with persisted params (multiple diagrams,
  restart-safe); the browser is both the route's left sidebar and a fixed
  right-panel tab.
- Draft autosave (3s debounce + unmount flush) with restore/discard banners,
  untitled-draft recovery on the home state, and create-only "Save as…".
- Client-side export to PNG/JPEG/SVG/PDF/XML/XMLPNG via blob download, plus
  copy-PNG-to-clipboard.
- needs-configuration posture until `instanceUrl` is set; docs-RPC probe with
  graceful degradation to workspace-only.
- Agent skill (`skills/drawio`) for file-level cooperation rules.
