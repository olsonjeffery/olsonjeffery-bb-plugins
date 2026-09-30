# Thread Cop

Watches every thread's tool calls and nudges the agent when one hangs past the
configured timeout. A tool call that has shown no start or progress activity
for longer than the timeout triggers an **Idle Tool Nudge** — a steer message
into the running turn (falling back to interrupt + fresh turn when steering is
unavailable), delivered once per hang, re-sent only after another full timeout
window, capped at 3 nudges per call.

## Settings

Rendered on the plugin's settings page by the host:

- **Tool Call Timeout (minutes)** (`toolCallTimeoutMinutes`, default `10`) — a
  tool call with no start or progress for longer than this is considered hung.
- **Hung Tool nudge prompt** (`hungToolNudgePrompt`, multi-line, default
  `Your tool call has hung and is not responding. What are your next steps?`) —
  the text sent as `Idle Tool Nudge: <prompt>`.

Invalid values (non-positive or non-numeric timeout, blank prompt) safe-degrade
to the defaults. Settings edits apply live via `onChange`, no reload needed.

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
  entry), and `turn/completed` (clears the thread's pending list). The
  follower seeds from the recent history at attach so a hang that predates it
  is caught too.
- **The hang clock is keyed to the tool-call item itself**: a call is due when
  `now − max(startedAt, lastProgressAt) > timeout`, so a hung sub-agent
  `Task` whose children still emit progress is not misjudged by its parent's
  silence, and a live command emitting output is not misjudged as hung.
- **One background service** (`bb.background.service("tool-hang-sweep")`)
  sweeps all monitors every 60 s — no per-thread timers, so reloads and
  disposes are safe. Before sending, the sweep re-checks the item in the
  event log and skips if it ended mid-sweep.
- **Delivery**: `bb.sdk.threads.send({ mode: "steer" })`. When steering is
  unavailable (e.g. `active-turn-not-steerable`) the plugin calls
  `threads.stop()` (interrupt) and sends a fresh user turn with the same text.
  `nudgedAt` is recorded on success and logged via `bb.log`.
- **Backpressure guard**: the monitored set is capped (200 threads); a
  follower that fails repeatedly is dropped and logged.
- Pending state lives in memory only — it is rebuilt from the event log
  after a restart, so nothing is persisted (no database tables).

## Development

```sh
npm install
npx vitest run    # unit + fake-plugin-host tests
npx tsc --noEmit  # typecheck
```

- `tool-watch.ts` — pure pending-list bookkeeping (no I/O), fully unit-tested.
- `server.ts` — plugin factory: settings, monitors, event-log followers, the
  background sweep, and lifecycle wiring.
