# Thread Cop

Watches every running thread and keeps stalled work moving — hung tool calls
get nudged, failed turns get retried, silent turns and stalled approvals get
flagged before they burn your session.

## What you get

- **Idle-tool nudges** — a tool call with no start or progress activity for
  longer than *Tool Call Timeout* (default 10 minutes) gets a steer message
  into the running turn (interrupt + fresh turn as the fallback), once per
  hang, re-sent only after another full window, capped at 3 per call.
- **Failed-turn retries** — transient provider failures (stream drops,
  overload, internal errors, unwindowed rate limits) re-queue automatically
  on a 1m/5m/15m backoff ladder, capped at *Max Failed-Turn Retries*
  (default 2); deterministic failures (bad request, unauthorized, billing,
  context window exceeded, …) are **never** retried, just logged loudly.
- **Silent-turn watchdog** — an active turn with no events at all for
  *Silent Turn Timeout* (default 15 minutes) gets a nudge, then a stop +
  fresh-turn escalation if it stays silent, capped at 2 interventions per
  silence episode.
- **Approval-stall alerts** — a pending approval or question older than
  *Approval Stall Alert* (default 10 minutes) is logged loudly, hourly while
  it stays pending; deliberately not auto-answered, because the agent is
  blocked on a human.
- **Context-pressure nudges** — when context-window use crosses
  *Context Pressure Threshold* (default 85%), the thread gets one nudge to
  summarize or compact; re-arms 15 points lower so a saw-tooth never spams.
- **Runaway-loop detector** (experimental) — *Runaway Loop: Repeats*
  identical tool/command signatures (default 8) inside the window and steers
  once, naming the repeated call; re-arms only after a distinct signature.
- **Zero-touch settings** — every timeout, cap, and nudge prompt is a
  plain-language setting on the plugin page (each prompt capped at 1000
  characters, safe-degraded to defaults when invalid) and applies live, no
  reload needed.

## Requirements

- bb `>=0.44`. Runs entirely server-side: no external services and nothing
  to configure per thread.

## How it works

- **Monitoring attaches to every thread.** `thread.created` plus a load-time
  scan of the threads currently occupying capacity pick up every thread;
  "this thread is watched" is recorded in the thread's `pluginMetadata`.
  `thread.active`/`thread.unarchived` re-attach, `thread.idle`/`failed`
  drain pending state, and `thread.archived`/`deleted` tear the monitor down.
- **Tool-call start/end comes from the pollable per-thread event log**, not a
  push event: a follower polls every 5 s for `item/started`,
  `item/toolCall/progress`, `item/commandExecution/outputDelta`,
  `item/completed`, and `turn/completed`, and also feeds the silent-turn and
  context-pressure checkers from interaction-lifecycle and window-usage rows.
  Every row refreshes the monitor's activity clock, and the clock is keyed
  to the tool-call item itself — so a hung parent whose children still emit
  progress is not misjudged, and a live command's output keeps it alive.
- **One background service** sweeps all monitors every 60 s — no per-thread
  timers, so reloads and disposes are safe; before sending, the sweep
  re-checks the item in the event log and skips it when it already ended.
- **Delivery** is a steer message into the running turn
  (`bb.sdk.threads.send({ mode: "steer" })`); when steering is unavailable
  the plugin interrupts (`threads.stop()`) and sends the same text as a fresh
  user turn.
- **Bookkeeping** lives in thread plugin metadata and in memory only — it is
  rebuilt from the event log after a restart, with no database tables. The
  monitored set is capped at 200 threads, and a follower that fails
  repeatedly is dropped and logged.

## Development

```sh
bb plugin install .
bb plugin dev
bb plugin logs thread-cop -f

npm test
npm run typecheck
```

- `tool-watch.ts` — pure pending-list bookkeeping (no I/O), fully unit-tested.
- `tc-failures.ts` — pure failed-turn classifier (retry/escalate/stand-down),
  fully unit-tested.
- `tc-loops.ts` — pure runaway-loop signatures and re-arm rules, fully
  unit-tested.
- `server.ts` — plugin factory: settings, monitors, event-log followers, the
  background sweep, the `turn.failed` handler, and lifecycle wiring.
