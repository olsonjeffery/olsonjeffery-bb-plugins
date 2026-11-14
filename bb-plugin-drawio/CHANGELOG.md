# Changelog

## 0.3.0 — one header row

- The plugin page's document view collapses to a **single header row**: the
  "← All diagrams" back control now lives at the left of the document
  toolbar (it doubles as the dead-link escape hatch), and the standalone
  back bar is gone. bb's own plugin panel header above it is bb chrome and
  stays.
- **The HTTPS/HTTP warning banner is gone.** It claimed the browser blocks
  the embedded editor whenever the app page is HTTPS and the instance HTTP —
  but bb's desktop webview renders that combination fine, so the banner was
  a standing false positive over a working editor ("row four is gibberish").
  If a frame genuinely fails to load, the connect/error fallback says so and
  offers retry.

## 0.2.0 — real read-only sidebar opens, fullscreen everywhere

- **Sidebar opens are actually read-only now.** Thread diagram tabs and every
  `fileOpener` open render draw.io's **static viewer** (`viewer.min.js`, fit
  and center with zoom + page nav) in a srcdoc frame instead of the embed
  editor — the viewer has no editing surface at all. The previous approach
  sent `editable: 0` on the embed `load` action, which every draw.io release
  silently ignores, so sidebar frames stayed fully editable. Read-only
  toolbars drop Save/Save As/Export (the viewer speaks no export protocol),
  show the read-only subtitle, reload from disk, and hand off with **Open in
  editor** — which routes the dashboard body to the document; no in-tab
  unlock. Draft-net and recovery stay dashboard-only, and persisted source
  params now canonicalize missing scope fields to null so RPC input always
  validates.
- **Fullscreen toggle on every diagram surface** (dashboard body, action
  tabs, thread tabs, fileOpener): one button in the toolbar lifts the whole
  surface (toolbar + frame) to the viewport — the Fullscreen API (native top
  layer, Escape exits) when the browser has it, otherwise a fixed overlay
  pinned `inset-0` that deliberately sits below bb's dialogs (z-40 < z-50) so
  they keep working over it; Escape also exits the overlay. Native-fullscreen
  surfaces drop the lift before opening the Save As or conflict dialogs,
  which portal outside the top layer.
- Editor/read-only frame chrome (the connecting/error body) is shared; the
  viewer detects a frame that never renders and offers retry instead of a
  silent blank.

- **One Open action, always a tab**: row click and the menu both open the
  diagram as a tab in the surface's own panel (plugin page or thread); the
  sidebar falls back to the body route if its panel controller declines.
- The thread's inline-diagram tab is a normal action tab again (the hidden
  launcher is gone — the likely cause of "Open in tab" doing nothing inside
  threads).

- **Diagrams inside threads**: a Diagram button in the thread header opens the
  Draw.io Browser in the thread's right panel (also available in that panel's
  New-tab menu); clicking a diagram pins it as an inline, CAS-saving tab
  beside the transcript.
- The window tab is renamed **Draw.io Browser**, and diagram tabs render with
  flush layout so the embedded editor spans the panel height (the inline tab
  no longer collapses to the editor's chrome height).

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
  origin validation.
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
