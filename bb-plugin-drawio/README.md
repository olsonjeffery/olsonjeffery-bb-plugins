# Drawio

Edit diagrams in BB with your own draw.io: the plugin embeds your self-hosted
draw.io webapp in the app shell and wires it to files you already own — Docs
vaults, project worktrees, host paths. No diagrams.net cloud dependency, no
separate store, no exports hoarded by the plugin: a diagram is just a
`.drawio` file that both you (in the embedded editor) and your agents (with
`bb docs` / file tools) read and write.

## Setup

1. Run a draw.io webapp somewhere reachable — the official
   [`jgraph/drawio`](https://hub.docker.com/r/jgraph/drawio) Docker image
   works as-is:
   ```sh
   docker run -d --name drawio -p 8080:8080 jgraph/drawio
   ```
   Prefer a supervised, boot-persistent setup? `deploy/setup-drawio-unit.sh`
   installs a systemd **user** unit that runs the official image on
   **0.0.0.0:12300**, enables it with lingering, and verifies readiness —
   see [`deploy/README.md`](./deploy/README.md):
   ```sh
   deploy/setup-drawio-unit.sh
   ```
2. Point the plugin at it under **Settings → Plugins → Drawio**, or:
   ```sh
   bb plugin config drawio set instanceUrl http://localhost:12300
   ```
   (Use an address your **browser** can reach — the editor iframe is loaded
   by the browser, not by the bb server.)
   Until a URL is set the plugin reports **needs-configuration**; drafts and
   workspace persistence already work, only the embedded editor waits.

## Surfaces

- **Diagrams nav panel** — the home state (New diagram, Import XML, recent
  vault diagrams, kept drafts) routes to the full-bleed editor via
  `open/…` deep links.
- **Draw.io Browser** — while the Diagrams route is active, the app sidebar
  becomes a vault picker + folder tree listing **every file in the vault**
  (diagrams open in the embedded editor; everything else opens in bb's
  built-in preview). The same browser is an **addable window type** —
  "Draw.io Browser" in a right panel's New-tab menu, on the plugin page AND
  inside threads — closable, next to diagram tabs. Every row has actions:
  open, open-in-tab (diagrams), and **Delete** (with a confirm; the kept
  draft goes with it). bb's own Docs browser lists Markdown/HTML only, so
  `.drawio` files only appear here.
- **Diagrams inside threads** — a **Diagram** button in every thread header
  opens/focuses the browser in that thread's right panel; clicking a diagram
  pins it as an inline tab beside the transcript (CAS saves work the same).
- **One tab per diagram** — each open diagram is an action tab with persisted
  params; several can be open at once, and they survive restarts.
- **System `.drawio` editor** — a `fileOpener` renders the embedded editor for
  any `.drawio` file BB opens: the file picker, a markdown link, or
  `bb thread open`.

## Persistence

- **Vaults** — diagrams live as `.drawio` files in official Docs vaults
  (default folder `diagrams/`), through the bundled Docs plugin's RPC: a
  cached snapshot for discovery (every file type, auto-refreshed after two
  minutes so agent-created files appear on their own), compare-and-swap
  `saveNote` writes, and `deletePath` deletes. A CAS
  conflict — an agent or another window saved meanwhile — never clobbers: the
  editor offers reload (your edit is kept as a draft) or overwrite.
- **Workspaces & host paths** — the fileOpener loads and saves through
  `bb.sdk.files` with `rootPath` confinement and the same CAS guard.
- **Drafts** — every dirty diagram autosaves to the plugin's SQLite 3s after
  the last keystroke and once more on close; a kept draft is offered to
  restore (or discard) the next time the diagram opens. Untitled drafts
  (imported XML) are listed on the home state until saved or discarded.

## Editor protocol

The iframe uses draw.io's embed mode (`?embed=1&proto=json&spin=1&libraries=1`)
with the JSON postMessage protocol: `init` → `load` → `save`/`autosave` events
→ `export` requests (PNG, JPEG, SVG, PDF, XML, XMLPNG) → browser download or
PNG-to-clipboard. Every inbound message is checked against the configured
instance origin before it is parsed, and outbound messages target that origin.

An https BB page cannot embed an http instance (browser mixed content); the
editor detects that and says so instead of showing a blank frame.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `instanceUrl` | *(empty)* | Base URL of your draw.io webapp; required for the editor |
| `defaultVaultId` | *(first vault)* | Vault where new diagrams are created |
| `defaultFolder` | `diagrams` | Vault folder for new diagrams |
| `uiTheme` | `min` | draw.io UI: `min`, `sketch`, or `atlas` |

The default instance URL this setup targets is `http://<host>:12300` when the
bundled systemd unit from `deploy/` runs the container.

## Running the instance under systemd

`deploy/drawio.service` + `deploy/setup-drawio-unit.sh` manage a systemd user
unit for the official `jgraph/drawio` image on `0.0.0.0:12300`: foreground
`docker run` supervised by systemd (no Docker restart policy to fight it),
deterministic stop/start cleanup, rootless-docker `DOCKER_HOST` detection via
the unit's env file, lingering for boot persistence, an HTTP readiness check,
and a `--check` mode that prints the plugin's next step. Full details,
exposure caveats, and troubleshooting: [`deploy/README.md`](./deploy/README.md).

## Scope notes (v0.1)

- The Docs plugin's RPC is used as-is; it is not a published API surface. The
  adapter is a thin, single-purpose module with a startup probe that degrades
  to workspace-only mode (vault features hide) if the contract ever moves.
- The vault file list is cached per vault in the plugin's SQLite and
  maintained incrementally on this plugin's own writes; the refresh button
  re-snapshots the whole vault.
- The agent skill (`skills/drawio`) explains the file-level rules so agents
  cooperate with the editor instead of racing it.
