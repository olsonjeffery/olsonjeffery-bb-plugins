# Thread Cop

Watches every thread and keeps stalled work moving. v1 covers hung tool
calls; v2 (issue #4) adds the failure-taxonomy coverage: failed-turn
retries, silent turns, stalled approvals, context pressure, and runaway
loops.

- **Idle Tool Nudge** (B1): a tool call that has shown no start or progress
  activity for longer than the timeout triggers a steer message into the
  running turn (falling back to interrupt + fresh turn when steering is
  unavailable), delivered once per hang, re-sent only after another full
  timeout window, capped at 3 nudges per call.
- **Failed-turn policy** (F1+F6): when a turn fails (`turn.failed`),
  transient provider failures (stream drops, connection failures,
  overload, internal errors, unwindowed rate limits; `unknown` with an
  http status ≥ 500 or no status at all) are re-queued via
  `threads.retry` on a 1m/5m/15m backoff ladder, capped at
  `maxFailedTurnRetries` per request; a reload cannot double-retry (the
  `v2.retriedFor` metadata key is the guard) and a windowed rate limit
  (`resetsAtMs`) or an already-queued retry row means stand-down — core is
  already handling it. Everything else (bad-request, unauthorized, policy,
  billing, budget-exceeded, context-window-exceeded, max-turns, …) is a
  deterministic failure that fails identically: it is **never** retried,
  just logged loudly (`v2.lastFailure`) for human attention.

## Settings

Rendered on the plugin's settings page by the host:

- **Tool Call Timeout (minutes)** (`toolCallTimeoutMinutes`, default `10`) — a
  tool call with no start or progress for longer than this is considered hung.
- **Hung Tool nudge prompt** (`hungToolNudgePrompt`, multi-line, default
  `Your tool call has hung and is not responding. What are your next steps?`) —
  the text sent as `Idle Tool Nudge: <prompt>`.
- **Retry Failed Turns** (`failedTurnRetriesEnabled`, default `true`) — the F1
  auto-retry switch; off leaves failed turns in `error` with a loud log.
- **Max Failed-Turn Retries** (`maxFailedTurnRetries`, default `2`) — the
  plugin's own retry cap per failed turn request.
- **Silent Turn Timeout (minutes)** (`silentTurnMinutes`, default `15`) — an
  active turn with no events at all gets a Silent Turn Nudge.
- **Silent turn nudge prompt** (`silentTurnPrompt`, multi-line).
- **Approval Stall Alert (minutes)** (`approvalStallMinutes`, default `10`) —
  a pending approval/question older than this is logged loudly; deliberately
  not a steer (the agent is blocked on a human — a queued send would fire the
  moment the human answers and corrupt the context). One alert per pending
  interaction, re-armed hourly while it stays pending.
- **Context Pressure Threshold (%)** (`contextPressureThresholdPct`, default
  `85`) — context-window usage crossing this gets one nudge to
  summarize/compact; re-arms 15 points below the threshold (no spam on a
  saw-tooth).
- **Context pressure nudge prompt** (`contextPressurePrompt`, multi-line).
- **Runaway Loop: Repeats** (`loopRepeatCount`, default `8`, experimental) —
  identical tool/command signatures inside the window that trigger one steer
  naming the repeated call.
- **Runaway Loop: Window (ms)** (`loopWindowMs`, default `480000`).
- **Runaway loop nudge prompt** (`loopPrompt`, multi-line, `{signature}`
  placeholder).

Every nudge prompt is capped at 1000 characters (host-validated; the settings
page shows a message under the field and `bb plugin config` rejects longer
values). The host decides the text area's height and any live counter — the
plugin cannot restyle it.

Invalid values safe-degrade to the defaults. Settings edits apply live via
`onChange`, no reload needed.

## How it works

- **Monitoring attaches to every thread.** `thread.created` (any) plus a
  load-time scan of the threads currently occupying capacity
  (`threads.listRunning`) pick up every thread; "this thread is watched" is
  recorded in the thread's `pluginMetadata` under this plugin's id
  (`watchdog: "watching"`). `thread.active`/`thread.unarchived` re-attach,
  `thread.idle`/`thread.failed` drain pending entries, and
  `thread.archived`/`thread.deleted` tear the monitor down.
- **Tool-call start/end is read from the pollable per-thread event log**
  (`bb.sdk.threads.events.list`), not a push event. A per-thread follower
  polls every 5 s for `item/started` (toolCall/commandExecution items with
  status `pending` → pending list, keyed by item id, first entry wins on
  duplicate starts), `item/toolCall/progress` and
  `item/commandExecution/outputDelta` (heartbeats for that call),
  `item/completed` (any end status, including `interrupted`, removes the
  entry), and `turn/completed` (clears the thread's pending list). It also
  feeds the v2 checkers from `system/interaction/lifecycle` rows (F3's
  pending-interaction tracking) and
  `thread/contextWindowUsage/updated` rows (F4's usage percentage).
  **Every row** refreshes the monitor's `lastEventAt` — F2's silence clock.
  The follower seeds from the recent history at attach so a hang that
  predates it is caught too.
- **The hang clock is keyed to the tool-call item itself**: a call is due when
  `now − max(startedAt, lastProgressAt) > timeout`, so a hung sub-agent
  `Task` whose children still emit progress is not misjudged by its parent's
  silence, and a live command emitting output is not misjudged as hung.
- **One background service** (`bb.background.service("tool-hang-sweep")`)
  sweeps all monitors every 60 s — no per-thread timers, so reloads and
  disposes are safe. Before sending, the sweep re-checks the item in the
  event log and skips if it ended mid-sweep. The sweep walks each monitor
  through the v2 checks in one pass, each independently skippable:
  **F2 silence → F3 approval stall → F4 context pressure** (F1/F6 act on
  `turn.failed` events the moment they fire; F5 delivers live from the loop
  detector).
- **F2 silent-turn watchdog**: an active turn with `now − lastEventAt` past
  `silentTurnMinutes` gets one Silent Turn Nudge (steer, falling back to
  stop + fresh turn); still silent another full window later → stop + fresh
  turn escalation; capped at 2 interventions per silence episode, cleared by
  `turn/completed` / `thread.idle`. Skipped while a pending interaction
  exists (the agent can't respond while blocked) and while a watched tool
  call is pending (that call owns the thread — B1's beat).
- **The silence clock restarts with the thread, not the turn**: `turn/started`
  is a watched event type and every watched row refreshes `lastEventAt`, and a
  monitor reactivated after `thread.idle`/`thread.failed` (drained, still
  resident) resets `lastEventAt` on the inactive → active transition — an
  idle gap never carries over into a resumed turn's window.
- **F5 runaway-loop detector** (experimental): a per-thread ring buffer of
  normalized call signatures (command text for commandExecution; tool name +
  compact input summary for toolCall). When `loopRepeatCount` identical
  signatures land within `loopWindowMs`, one steer names the repeated call;
  re-arms only after a distinct signature interleaves.
- **Delivery** (all nudges): `bb.sdk.threads.send({ mode: "steer" })`. When
  steering is unavailable (e.g. `active-turn-not-steerable`) the plugin calls
  `threads.stop()` (interrupt) and sends a fresh user turn with the same
  text. Nudge timestamps are recorded and logged via `bb.log`.
- **Bookkeeping** lives in the thread's plugin metadata under the `v2` key
  (`lastFailure`, `retriedFor`, `approvalAlertAt`, `contextAlertAt`,
  `loopAlertAt`); pending state lives in memory only — it is rebuilt from
  the event log after a restart, so nothing is persisted (no database
  tables).
- **Backpressure guard**: the monitored set is capped (200 threads); a
  follower that fails repeatedly is dropped and logged.

## Development

```sh
npm install
npx vitest run    # unit + fake-plugin-host tests
npx tsc --noEmit  # typecheck
```

- `tool-watch.ts` — pure pending-list bookkeeping (no I/O), fully unit-tested.
- `tc-failures.ts` — pure failed-turn classifier (retry/escalate/stand-down),
  fully unit-tested.
- `tc-loops.ts` — pure runaway-loop signatures and re-arm rules, fully
  unit-tested.
- `server.ts` — plugin factory: settings, monitors, event-log followers, the
  background sweep, the `turn.failed` handler, and lifecycle wiring.
