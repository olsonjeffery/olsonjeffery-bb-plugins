# plugins

A collection of BB plugins. Install one by its subdirectory:

```sh
bb plugin install git:https://github.com/olsonjeffery/olsonjeffery-bb-plugins.git --subdirectory bb-plugin-enter-guard
```
- **enter-guard** — Keeps a stray Enter from sending a half-written message: double-Enter to send, with a visible confirm window and no surprise sends while a suggestion menu is open.
- **thread-cop** — Watches every thread and keeps stalled work moving: hung tool calls get nudged, failed turns are retried on a backoff ladder, and silent turns, stalled approvals, and runaway loops get flagged before they burn the session.
- **personas** — Build a reusable fleet of AI personas: each with its own prompt pool, provider, model, and reasoning level, chatting in ordinary BB threads; with the Thread Tags plugin installed, new persona chats wear the persona's sidebar badge.
- **drawio** — Diagrams with your own draw.io: the self-hosted webapp embeds in the app shell and opens and CAS-saves `.drawio` files in Docs vaults, project worktrees, and host paths — one tab per diagram, draft autosave so a close never loses work, and client-side export to PNG/JPEG/SVG/PDF/XML.
- **basic-systemone** — SystemOne Decision Model foundation: designate a provider + decision model, then ask it typed questions over the SystemOne API with `bb systemone`; everything stays disabled until a model is designated, and other plugins build on its RPC contract.

Each plugin is an ordinary BB plugin package under its own directory; see the
[plugin guide](https://getbb.app/plugin-guide) for the manifest and build details.
