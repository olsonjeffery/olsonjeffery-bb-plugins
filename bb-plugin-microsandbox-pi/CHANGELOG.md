# Changelog

## 0.3.0 — phase 3: the sandboxed pi provider works end to end

- **Provider "pi (microsandbox)"** — bb threads run their whole pi agent
  inside an msb microVM through a two-hop bridge
  (`runtime ⇄ bridge child ⇄ per-session relay ⇄ msb box (vsock) ⇄ bb's own
  bridge-worker + provider-pi artifact in-box`). Spawn/dial/turn verified:
  initialize capabilities, a full model catalog, and a real turn with
  reasoning deltas, agent text and token usage all round-trip in-box.
  Sessionless calls (`initialize`/`model/list`/`skills/configure`) run in a
  workspace-free meta box that mounts `$HOME`; thread boxes mount the exact
  workspace. Provider health is answered host-side from the watcher's probe.
- **Protocol parity from the daemon, not a cache.** The in-box child is bb's
  `plugin-host-artifacts/provider-pi/<hash>/host.mjs` run via bb's
  `bb-provider-bridge-worker.mjs`, both located from the running daemon
  (`worker` via this child's own argv). The artifact joins the runtime with
  `sessionRestore: true`, `fork: checkpoint`, steer injection. Env overrides
  `MSP_PROVIDER_ARTIFACT` / `MSP_BRIDGE_WORKER` stay for dev.
- **Box lifecycle that can't cross wires.** Deterministic names
  (`bbp-<threadfragment>`, `bbp-meta`); ownership-marked socket dirs
  (`owner.json` records the owning child pid) so a live box is only reused
  by the child that created it; every foreign/owned-gone box is removed and
  recreated rather than reusing lanes the guest already dialed away;
  cold relays are single-flight per key (one shared boot promise per
  box). Boot failures are errors now (`never reached running within 120s`,
  `msb run failed` with the CLI's stderr), never silent no-box returns.
- **Listeners first, box second.** Relays bind their three unix lanes before
  `msb run`, so the guest shim's one-dial-per-lane boot lands on live
  listeners — no muxer redial churn, no silent loss of the first buffered
  line into a probe socket.
- **Secrets stay host-side.** Per-route msb substitution
  (`$MSB_<ENV>` at egress, TLS interception when keys are present) with the
  default route set matching the host providers; pi reads stored logins and
  skills from `~/.pi/agent`, which must be mounted read-write (off = strict
  secret-substitution-only). The pi session dir (`~/.bb/pi-bridge-sessions`)
  is a read-write bind so sessions survive box idle-stop.
- **In-box runner shim hardened.** The stderr tee crashed on day one (a
  read on a write-only handle) so dying children were invisible; it now
  pumps child stderr to both the err lane and `/w/child-stderr.log` teed
  live, records `bridge exited <code>` in `/w/runner-final.log`, pre-creates
  the worker's data dir, and retries vsock dials for 2 minutes.
- **Diagnostics as settings, not litter.** "Journal the sandbox bridge
  protocol lines" (off by default) appends a capped `bridge-journal.jsonl`
  (in/out/lane/loss notes) under the bridge data dir; bb's own child-IO
  recorder is documented (`BB_PROVIDER_BRIDGE_RECORD_DIR` passthrough).
  provider/health answers from the watcher's probe (msb + pi presence).
- Renders/breadcrumbs removed from the flow; the old `bb-pi-bridge.mjs`
  lookup that silently mounted a bb-0.35 dialect (which is why `initialize`
  stalled for two days) is gone.

## 0.2.0 — phase 2: dynamic tools, npm "latest", in-box view, history shaping

- **Agent tools** — four schema'd tools agents can call directly from any
  thread, no shell required: `msb_pi_versions`, `msb_pi_probe`, `msb_pi_boxes`,
  `msb_pi_history` (plain-text answers; `machine` narrows to one host).
- **In-box view** — each snapshot now carries the machine's own msb runtime
  inventory, parsed from the `msb list` fixed-width table (name, image, state,
  created): a filtered `boxes` row on the page cards, the new
  `bb microsandbox-pi boxes [--machine] [--running] [--refresh] [--json]` command, and
  the `msb_pi_boxes` tool.
- **npm "latest available"** — every install carries the npm package name it
  maps to (pi's managed tree resolves through its lockfile root's dependency,
  `@earendil-works/pi-coding-agent`; global npm installs walk up from the
  binary; msb is always `microsandbox`). The server caches dist-tag answers
  for 6 hours, refetches at most 4 per cycle, and degrades offline answers to
  a stale note — never an error. Shown as `update available · <version>` /
  `up to date` / `npm latest · <version>` chips on the page, `npm` lines in
  CLI output, and under `npmLatest` in JSON answers.
- **History retention** — storage shaping on write: the last 24h stays in
  full, older entries collapse to the newest change per machine per tool per
  calendar day (UTC), and the log remains capped at 200.
- p14s-class machines (global npm pi install, no managed tree) now get full
  npm answers too.
- Fixed: a PATH shim whose module target lives outside the install tree (pi's
  wrapper exec model) now finds the active release by the probed version
  itself, so npm answers aren't lost on wrapper-style installs.

## 0.1.0 — first watch

- Version watcher for microsandbox (`msb`) and the pi coding agent (`pi`)
  across every enrolled bb machine: per-machine snapshots, install origins,
  pi release lists, and a capped change history.
- `bb.host` probe artifact per machine — PATH resolution, managed-install
  discovery (including the bin shim's realpath and `PI_MANAGED_INSTALL_ROOT`),
  extra-path support for npm-local msb installs, `~/.msb` state-dir note,
  8 s `--version` timeout, fail-soft statuses.
- "MSB + pi" nav panel page: machine cards (connection dot, platform,
  checked-ago, per-machine refresh), tool rows with version/origin/path,
  release chips, history log, realtime refetch, shared query cache with
  tag invalidation on refresh.
- `bb microsandbox-pi versions|refresh|history` CLI with `--machine`, `--refresh`,
  `--limit`, `--json`.
- Settings: check interval (1–720 min, default 15), extra msb paths, pi
  managed-install root override. Settings changes trigger an immediate probe.
- Background probe service with mutex-serialized cycles, jittered cadence,
  and abort-safe shutdown.
