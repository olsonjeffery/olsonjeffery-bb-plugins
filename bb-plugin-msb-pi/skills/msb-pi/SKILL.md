---
name: msb-pi
description: Check which microsandbox (msb) and pi coding agent versions are installed on each bb machine — the `bb msb-pi` command, the monitor state behind it, and how to force a fresh probe.
---

---
name: msb-pi
description: Get installed microsandbox (msb) and pi coding agent versions per bb machine — the `bb msb-pi` command, the plugin's agent tools (versions, probe, in-box sandbox listing, history), npm update hints, and how to force a fresh probe.
---

# MSB + pi version watcher

This plugin watches every machine enrolled with bb for installed versions of
the microsandbox CLI (`msb`) and the pi coding agent (`pi`). It keeps one
snapshot per machine (versions, install origins, npm updates, the machine's
msb runtime sandbox list) plus a change history, shows everything on its
"MSB + pi" page, and answers over `bb msb-pi` or its agent tools.

## Agent tools

From any thread (no CLI needed):

- `msb_pi_versions` / `msb_pi_probe` — stored results, or a live probe now.
- `msb_pi_boxes` — each machine's msb runtime sandboxes (name, image, state).
- `msb_pi_history` — recorded version changes.

All four accept an optional `machine` (host id or name prefix) to target one
host; otherwise they report across every machine.

## Commands

- `bb msb-pi versions` — print per machine: pi and msb versions, install
  origin, resolve paths, every installed pi release, npm-update hints, and the
  machine's msb sandbox list. Fast: reads the stored state, no probing.
  - `--machine <id|prefix>` — only that machine (host id or name prefix).
  - `--refresh` — probe first (takes a few seconds; runs `--version` on each
    machine), then print.
  - `--json` — machine-readable JSON envelope (`{ ok: true, result: … }` with
    the full state under `machines`/`history`/`npmLatest`).
- `bb msb-pi refresh [--machine <ref>] [--json]` — force a probe cycle now and
  leave the results as the new stored state.
- `bb msb-pi boxes [--machine <ref>] [--running] [--refresh] [--json]` — the
  in-box view: each machine's msb runtime sandboxes as recorded at the last
  probe.
- `bb msb-pi history [--machine <ref>] [--limit N] [--json]` — version changes
  recorded so far, newest first.

## Reading the output

- `not found` means the tool genuinely isn't visible to the probe — absence is
  a fact, not a failure. pi checks PATH and the managed install
  (`~/.pi/agent/install`, override with the plugin's `pi managed-install root`
  setting); msb checks PATH plus the plugin's "Extra msb paths" setting.
- `probe failed` means the tool was found but `--version` failed or hung; the
  error line says why.
- `npm      update available — latest X` compares the install against the
  npm registry (6-hour cached answers; offline degrades to a stale note).
- Disconnected machines keep their last snapshot and are labeled
  `disconnected`; refresh failures also surface there.
- pi keeps several versions under `releases/`; the page and `--json` include
  all of them, with the active one first.

## Notes

- Probes run on the machine itself (`--version`, filesystem reads, and
  `msb list` only); nothing is sent anywhere.
- Background re-probes default to every 15 minutes (`Check interval
  (minutes)` setting; 1–720).
- History is shaped on write: the last 24h stays in full, older entries
  collapse to one per machine per tool per day, capped at 200.
