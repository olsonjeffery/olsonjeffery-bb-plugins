---
name: msb-pi
description: Check which microsandbox (msb) and pi coding agent versions are installed on each bb machine — the `bb msb-pi` command, the monitor state behind it, and how to force a fresh probe.
---

# MSB + pi version watcher

This plugin watches every machine enrolled with bb for installed versions of
the microsandbox CLI (`msb`) and the pi coding agent (`pi`). It keeps one
snapshot per machine plus a change history, shows both on its "MSB + pi" page,
and answers from the same state over `bb msb-pi`.

## Commands

- `bb msb-pi versions` — print per machine: pi and msb versions, install
  origin, resolve paths, and (for pi) every installed release. Fast: reads the
  stored state, no probing.
  - `--machine <id|prefix>` — only that machine (host id or name prefix).
  - `--refresh` — probe first (takes a few seconds; runs `--version` on each
    machine), then print.
  - `--json` — machine-readable JSON envelope (`{ ok: true, result: … }` with
    the full state under `machines`/`history`).
- `bb msb-pi refresh [--machine <ref>] [--json]` — force a probe cycle now and
  leave the results as the new stored state.
- `bb msb-pi history [--machine <ref>] [--limit N] [--json]` — version changes
  recorded so far, newest first.

## Reading the output

- `not found` means the tool genuinely isn't visible to the probe — absence is
  a fact, not a failure. pi checks PATH and the managed install
  (`~/.pi/agent/install`, override with the plugin's `pi managed-install root`
  setting); msb checks PATH plus the plugin's "Extra msb paths" setting.
- `probe failed` means the tool was found but `--version` failed or hung; the
  error line says why.
- Disconnected machines keep their last snapshot and are labeled
  `disconnected`; refresh failures also surface there.
- pi keeps several versions under `releases/`; the page and `--json` include
  all of them, with the active one first.

## Notes

- Probes run on the machine itself (`--version` and filesystem reads only);
  nothing is sent anywhere.
- Background re-probes default to every 15 minutes (`Check interval
  (minutes)` setting; 1–720).
