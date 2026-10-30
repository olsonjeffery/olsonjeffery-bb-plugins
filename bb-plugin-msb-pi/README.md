# MSB + pi

A bb plugin that watches every enrolled machine for the two toolchains our
sandbox-road needs and shows what it found: the [microsandbox](https://microsandbox.dev)
CLI (`msb`) and the pi coding agent (`pi`).

One page, one CLI, one history:

- **Page** — "MSB + pi" in the navigation: a card per machine with each
  tool's active version, install origin, resolve path, all installed pi
  releases, and a change log (`1.2.9 → 1.3.0`) recorded across probes.
- **CLI** — `bb msb-pi versions|refresh|history` for agents and scripts, with
  `--json` everywhere.
- **Probe** — a `bb.host` artifact runs on each machine; it only ever resolves
  binaries and runs `--version`. Absence is a fact ("not found"), not an
  error, and a hung CLI degrades to a readable error after 8 seconds.

## Why

We are building toward running pi inside msb microVMs from bb; before
provisioning anything, the fleet should be able to say, honestly, which
machines have which toolchain versions right now — and when that last
changed. This plugin is that memory.

## Surfaces

| Where | What |
| --- | --- |
| Navigation → MSB + pi | Machine cards + version history |
| `bb msb-pi versions [--machine <ref>] [--refresh] [--json]` | Stored results (red text for probe failures) |
| `bb msb-pi refresh [--machine <ref>] [--json]` | Probe now, keep results |
| `bb msb-pi history [--machine <ref>] [--limit N] [--json]` | Recorded version changes |
| Settings → Installed plugins → MSB + pi | Check interval, extra msb paths, pi managed-root override |

## How it works

- Every cycle, the server asks each **connected** enrolled host (via its
  `bb.host` worker) for a snapshot: probe `pi` (PATH + managed install with
  `releases/` listing, active version resolved through the bin shim's
  realpath) and `msb` (PATH + configured extra paths, `~/.msb` state-dir
  note). One snapshot per host is stored in plugin kv storage.
- Version transitions between consecutive snapshots are appended to a capped
  (200-entry) history. Exact replays collapse; real flips stay.
- After every cycle the server publishes a realtime ping, so open pages
  refetch. A completed refresh also invalidates the page's query cache via
  its RPC tag.
- Cycles serialize behind a mutex: concurrent refreshes (page + CLI + timer)
  can't interleave or double-record.

## Settings

- **Check interval (minutes)** — background re-probe cadence, 1–720, default 15.
- **Extra msb paths** — newline-separated directories (or full binary paths)
  to also check for `msb`; `~/` expands. For npm-local installs like
  `~/nono-lab/node_modules/.bin`.
- **pi managed-install root** — override for `~/.pi/agent/install`
  (auto-detect also consults `PI_MANAGED_INSTALL_ROOT`, when present).

## Privacy

Probes are local: binary resolution and `--version` runs on each machine. No
network requests, no telemetry. Snapshot state lives in this plugin's own bb
storage.

## Development

```sh
npm install
npm run test        # vitest: probe/diff/render/store logic
npm run typecheck   # tsc --noEmit
bb plugin build     # server.js + host.js + app bundle
bb plugin install . # live install for testing
```

MIT licensed; see [CHANGELOG.md](./CHANGELOG.md) for versions.
