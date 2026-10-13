# maki Agent Provider

Run bb threads with the [maki](https://maki.sh) coding agent. bb talks to `maki acp` over the
[Agent Client Protocol](https://agentclientprotocol.com), so models, sessions, tool events,
permissions, and plan/build modes stay maki's own.
 
## What you get

- The maki provider appears in bb wherever maki is installed — and only there; machines without
  it list nothing and have nothing to configure in bb.
- Update notifications run through bb's usual prompts: the plugin compares the installed
  `maki --version` against the latest GitHub release (checked at most every 10 minutes) and
  offers **`maki update`** when a newer release exists, the same notifier codex and Claude Code
  use; when maki is missing, bb offers the maki.sh install script instead.
- The installed maki version shows per machine in bb's machine/provider views and
  `bb updates status`; Settings → *maki* lists the version and executable path for every
  connected machine.
- Threads on the provider draw maki's own brand icon and colors.

## Requirements

- maki installed on every machine that will run it (`maki acp` must be there; the provider does
  not install it for you, though bb's update prompts offer the installer when it is missing).
- bb `>=0.45`.

## Development

```sh
bb plugin install .
bb plugin dev
bb plugin logs maki-agent-provider -f

npm test
npm run typecheck
```

- `server.ts` — registers the provider and answers the per-machine status RPC.
- `src/host.ts` — the `bb.host` artifact: the wrapped provider bridge plus the status handler.
- `src/bridge.ts` — wraps the SDK ACP bridge and intercepts only `provider/installation/*`.
- `src/maki-maintenance.ts` — maki install/update status, GitHub latest-version cache.
