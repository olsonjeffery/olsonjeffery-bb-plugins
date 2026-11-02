---
name: microsandbox-pi
description: The microsandbox sandbox road — the experimental "pi (microsandbox)" provider (pi threads running inside msb microVMs: boxes, secret routing, failures) and the `bb microsandbox-pi` version watcher (versions, probe, in-box sandbox listing, history, npm update hints, fresh probes).
---

# MSB + pi

Two halves:

1. **The sandboxed pi provider** — threads using the provider
   "pi (microsandbox)" run their whole agent inside an msb microVM with
   secrets substituted only on configured egress hosts (see below).
2. **The version watcher** — every machine enrolled with bb reports installed
   versions of the microsandbox CLI (`msb`) and the pi coding agent (`pi`)
   on the plugin's Settings detail page (Settings → Installed plugins →
   MSB + pi → "Version watch"), over `bb microsandbox-pi`, and through
   agent tools, with a change history. There is no navigation-page entry
   for it; the watch is background machinery.

## The sandboxed pi provider

Spawn threads with the provider `pi (microsandbox)`; pi agents run inside
msb boxes (`bbp-<threadfragment>` per thread plus a workspace-free `bbp-meta`
box for sessionless calls). Architecture that keeps it diagnosable:

- The in-box child is bb's own provider-pi artifact + bridge worker (located
  from the running daemon) — the protocol dialect always matches the runtime.
- `~/.pi/agent` is mounted read-write in-box (pi needs settings locks and
  model data), so pi in-box has the host's skills and stored logins.
- API keys never enter the box in plaintext: msb substitutes them on the
  configured egress hosts (secret routes, TLS interception).
- Sessions persist across box idle-stop: `~/.bb/pi-bridge-sessions` is a
  read-write host bind and the provider declares `sessionRestore`.
- Boxes auto-remove on bridge close/SIGTERM/relay loss; leftover shapes can
  be listed with `bb microsandbox-pi boxes` and removed with `msb remove -f`.
- Debugging: since 0.3.0, Settings → "Journal the sandbox bridge protocol
  lines" writes `<dataDir>/bridge-data/bridge-journal.jsonl`; the daemon can
  additionally record full child IO with `BB_PROVIDER_BRIDGE_RECORD_DIR`.

## Agent tools

From any thread (no CLI needed):

- `msb_pi_versions` / `msb_pi_probe` — stored results, or a live probe now.
- `msb_pi_boxes` — each machine's msb runtime sandboxes (name, image, state).
- `msb_pi_history` — recorded version changes.

All four accept an optional `machine` (host id or name prefix) to target one
host; otherwise they report across every machine.

## Commands

- `bb microsandbox-pi versions` — print per machine: pi and msb versions, install
  origin, resolve paths, every installed pi release, npm-update hints, and the
  machine's msb sandbox list. Fast: reads the stored state, no probing.
  - `--machine <id|prefix>` — only that machine (host id or name prefix).
  - `--refresh` — probe first (takes a few seconds; runs `--version` on each
    machine), then print.
  - `--json` — machine-readable JSON envelope (`{ ok: true, result: … }` with
    the full state under `machines`/`history`/`npmLatest`).
- `bb microsandbox-pi refresh [--machine <ref>] [--json]` — force a probe cycle now and
  leave the results as the new stored state.
- `bb microsandbox-pi boxes [--machine <ref>] [--running] [--refresh] [--json]` — the
  in-box view: each machine's msb runtime sandboxes as recorded at the last
  probe.
- `bb microsandbox-pi history [--machine <ref>] [--limit N] [--json]` — version changes
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
