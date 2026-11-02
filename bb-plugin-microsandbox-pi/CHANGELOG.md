# Changelog

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
