# Changelog

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
- `bb msb-pi versions|refresh|history` CLI with `--machine`, `--refresh`,
  `--limit`, `--json`.
- Settings: check interval (1–720 min, default 15), extra msb paths, pi
  managed-install root override. Settings changes trigger an immediate probe.
- Background probe service with mutex-serialized cycles, jittered cadence,
  and abort-safe shutdown.
