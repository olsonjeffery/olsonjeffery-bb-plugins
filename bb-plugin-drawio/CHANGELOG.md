# Changelog

## 0.1.0 — the core loop

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
