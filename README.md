# plugins

A collection of BB plugins. Install one by its subdirectory:

```sh
bb plugin install git:https://github.com/olsonjeffery/olsonjeffery-bb-plugins.git --subdirectory bb-plugin-enter-guard
```
- **enter-guard** — Keeps a stray Enter from sending a half-written message: double-Enter to send, with a visible confirm window and no surprise sends while a suggestion menu is open.
- **thread-cop** — Watches every thread and keeps stalled work moving: hung tool calls get nudged, failed turns are retried on a backoff ladder, and silent turns, stalled approvals, and runaway loops get flagged before they burn the session.
- **personas** — Build a reusable fleet of AI personas: each with its own prompt pool, provider, model, and reasoning level, chatting in ordinary BB threads.
- **maki-agent-provider** — Run bb threads with the maki coding agent over ACP, with update notifications and the installed version per machine.

Each plugin is an ordinary BB plugin package under its own directory; see the
[plugin guide](https://getbb.app/plugin-guide) for the manifest and build details.
