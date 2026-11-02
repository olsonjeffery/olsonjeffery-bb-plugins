# MSB + pi

A bb plugin for the [microsandbox](https://microsandbox.dev) sandbox road:
(1) the **"pi (microsandbox)" provider**, which runs bb threads' whole pi
agent inside msb microVMs, and (2) a fleet watch that shows which machines
have which `msb` and `pi` versions right now — and when that last changed.

Watch surfaces (Settings section, one CLI, four agent tools, one history —
no navigation entry; the watch is background machinery):

- **Page** — "MSB + pi" in the navigation: a card per machine with each
  tool's active version, install origin, resolve path, npm update chips,
  the machine's msb sandbox list, all installed pi releases, and a change
  log (`1.2.9 → 1.3.0`) recorded across probes.
- **CLI** — `bb microsandbox-pi versions|refresh|history|boxes` for agents and
  scripts, with `--json` everywhere.
- **Agent tools** — `msb_pi_versions`, `msb_pi_probe`, `msb_pi_boxes`,
  `msb_pi_history`: schema'd tools any bb thread can call directly.
- **Probe** — a `bb.host` artifact runs on each machine; it only ever
  resolves binaries, runs `--version`, and reads `msb list`. Absence is a
  fact ("not found"), not an error, and a hung CLI degrades to a readable
  error after 8 seconds.

## npm update hints

Every install carries the npm package name it maps to:

- managed pi installs resolve `@earendil-works/pi-coding-agent` through the
  lockfile root's single dependency (the `…-install` root itself is private
  and unpublishable — its registry endpoint answers `Unauthorized`, and the
  plugin never queries it);
- global npm installs walk up from the resolved binary;
- msb is always `microsandbox`.

The server asks `registry.npmjs.org/-/package/<name>/dist-tags`, caches the
answer for 6 hours, refetches at most four packages per probe cycle, and
marks unreachable-registry answers stale instead of emptying them.
Meanwhile the in-box view of a machine's msb runtime (`msb list` — the
spike boxes live on!) rides the same snapshot.

## Why

The sandbox road needs both halves: the fleet memory about toolchains
(before provisioning anything, machines should be able to say which
versions exist and when that last changed) and now the sandbox itself.
This plugin is both.

## Surfaces

| Where | What |
| --- | --- |
| **Provider "pi (microsandbox)"** | bb threads run pi entirely inside an msb microVM (see below) |
| Settings → Installed plugins → MSB + pi → "Version watch" | Machine cards (versions, update chips, sandbox list) + version history |
| Agent tools `msb_pi_versions` / `msb_pi_probe` / `msb_pi_boxes` / `msb_pi_history` | Direct answers in any thread |
| `bb microsandbox-pi versions [--machine <ref>] [--refresh] [--json]` | Stored results with npm hints |
| `bb microsandbox-pi refresh [--machine <ref>] [--json]` | Probe now, keep results |
| `bb microsandbox-pi boxes [--machine <ref>] [--running] [--refresh] [--json]` | Each machine's msb runtime sandboxes |
| `bb microsandbox-pi history [--machine <ref>] [--limit N] [--json]` | Recorded version changes |
| Settings → Installed plugins → MSB + pi | Check interval, extra msb paths, box image/resources, mounts, secret routes, npm check, bridge journal — and below the form, the "Version watch" section (the former dashboard, refetching on each probe cycle) |

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

## The sandboxed pi provider

Threads with the provider **"pi (microsandbox)"** run the whole pi agent
inside an msb microVM instead of on the host. The provider bridge keeps an
msb box per thread (`bbp-<threadfragment>` plus one workspace-free meta box
for sessionless calls) and pumps the runtime's Provider Bridge Protocol
lines through it:

```
runtime ⇄ bridge child ⇄ per-session relay (unix listeners)
       ⇄ msb box (vsock lanes in/out/err)
       ⇄ bb's bridge-worker + provider-pi artifact in-box (spawned pi --mode rpc)
```

Design notes that keep it honest:

- **Protocol parity, not a frozen dialect.** The in-box child is bb's own
  `plugin-host-artifacts/provider-pi/<hash>/host.mjs` (the bundle the daemon
  itself drives), run through bb's `bb-provider-bridge-worker.mjs` —
  both are located from the running daemon, never from a stale npx cache.
- **Box ownership.** Box names and socket dirs are deterministic per
  thread; a live box is only reused when `owner.json` in its socket dir
  names THIS bridge child, so a child restart or a second bridge process
  can never argue with another child's lanes. Cold relays are
  single-flight per key (one boot promise shared by concurrent calls).
- **Listeners first, box second.** The relay binds its three unix lanes
  before `msb run`, so the guest shim's one-dial-per-lane boot connects
  straight into live listeners — no muxer redial churn.
- **Sessionless meta box.** `initialize` / `model/list` / `skills/configure`
  run in a workspace-free meta box that mounts `$HOME`; pi's spawn cwd for
  model resolution always exists in-box without per-cwd box reboots.
- **Sessions survive box idle-stop.** The pi session dir
  (`~/.bb/pi-bridge-sessions`) is a read-write host bind, and
  `sessionRestore: true` lets a fresh boot resume the thread.
- **Secrets stay host-side.** API keys reach the box only through msb's
  `$MSB_<NAME>` substitution on the configured egress hosts
  (TLS interception on) — no plaintext credentials in-box.
- **pi needs a writable agent dir.** `~/.pi/agent` is mounted read-write
  (shared state, as on the host): pi takes settings locks, stores model
  data, and launches skills from there in-box. Turn it off for strict
  secret-substitution-only auth (pi then has no skills and no stored
  credentials in-box).

Provider failures surface as JSON-RPC errors with a `restartRecommended`
hint; dead boxes are removed on relay loss, SIGTERM, and bridge close.

## Settings

- **Check interval (minutes)** — background re-probe cadence, 1–720, default 15.
- **Extra msb paths** — newline-separated directories (or full binary paths)
  to also check for `msb`; `~/` expands. For npm-local installs like
  `~/nono-lab/node_modules/.bin`.
- **pi managed-install root** — override for `~/.pi/agent/install`
  (auto-detect also consults `PI_MANAGED_INSTALL_ROOT`, when present).
- **Sandbox image / CPUs / memory / idle stop** — the msb box shape
  (default `node:22-bookworm`, 2 vCPU, 2 GiB, 30-minute idle stop).
- **Extra box mounts** — additional `SRC:DEST[:ro]` binds for every box.
- **Secret routes (msb substitution)** — `ENV@host[,host…]` lines; keys
  present in the daemon env never enter the box in plaintext.
- **Mount ~/.pi/agent in-box (read-write)** — off for strict
  secret-substitution-only auth.
- **Check npm for the newest release** — the dist-tags comparison, default on
  (6h cache; bounded to four registry hits per cycle; offline answers age in
  place as "stale", never empty).
- **Journal the sandbox bridge protocol lines** — appends a capped-line
  bridge journal to `<dataDir>/bridge-data/bridge-journal.jsonl`
  (receive/send/loss notes; off by default). For live protocol debugging,
  bb's own recorder can also be armed by running the daemon with
  `BB_PROVIDER_BRIDGE_RECORD_DIR=<dir>` (passed through to provider childs).

## Privacy

Probes are local: binary resolution, `--version` runs, and `msb list` on each
machine. The sandbox provider adds msb box runs, plain `msb list` polling on
box shape changes and — for pi turns — the model traffic itself (hosted
API calls from the box, secret-substituted per route). Snapshot state lives
in this plugin's own bb storage.

## Development

```sh
npm install
npm run test        # vitest: probe/diff/render/store logic
npm run typecheck   # tsc --noEmit
bb plugin build     # server.js + host.js + app bundle
bb plugin install . # live install for testing
```

MIT licensed; see [CHANGELOG.md](./CHANGELOG.md) for versions.
