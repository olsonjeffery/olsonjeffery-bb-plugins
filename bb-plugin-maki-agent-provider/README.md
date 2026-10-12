# maki Agent Provider

Run bb threads with the [maki](https://maki.sh) coding agent. bb talks to `maki acp` over the
[Agent Client Protocol](https://agentclientprotocol.com); the provider only appears on machines
where maki is installed.

## What the plugin does

- **Provider registration** — installs bb's shared ACP bridge pointed at `maki acp`
  (generic dialect). Models, sessions, tool events, permissions and plan/build modes come from
  maki's own config; no extra settings and nothing to configure in bb.
- **Update notifier** — the bridge answers bb's installation maintenance for maki: it compares
  `maki --version` against the latest GitHub release (fetched at most every 10 minutes) and, when
  a newer release exists, bb's usual update prompts (sidebar badge, Settings, per-machine install
  runner) offer **`maki update`** — the same notifier codex and Claude Code use. If maki is
  missing, bb offers the maki.sh install script instead.
- **Per-machine version** — provider health reports the installed maki version per machine, shown
  in bb's machine/provider views and `bb updates status`.
- **One-click OpenCode port** — in Settings → *maki Agent Provider* → *OpenCode providers*,
  **Add OpenCode Providers to maki** copies every custom provider from the machine's opencode
  config (`~/.config/opencode/opencode.json`, or `$OPENCODE_CONFIG`) into
  `~/.config/maki/providers.toml` on every connected machine at once, and reports what it did per
  machine.

## The OpenCode port, in detail

For each `[provider.<slug>]` entry in opencode's config:

| opencode | maki |
| --- | --- |
| `npm = "@ai-sdk/openai-compatible"` (and friends) | `protocol = "openai"` (`@ai-sdk/anthropic` → `"anthropic"`, `@ai-sdk/google*` → `"google"`, `@ai-sdk/openai-responses` → `"openai-responses"`) |
| `options.baseURL` | `base_url` |
| `options.apiKey`, or a stored `type: "api"` key for that slug in opencode's `auth.json` | inline `api_key` (the file is written with mode 0600) |
| stored OAuth sessions | skipped with a note pointing at `maki auth login <slug>` |
| `models` entries | `[[slug.models]]` rows: the `slug/` prefix is stripped from the id; `limit.context` → `context_window`, `limit.output` → `max_output_tokens`, `cost.*` → `pricing_*`, `reasoning: true` → `supports_thinking` |
| a provider with no inline `models` | `discover_models = true` (maki lists from the endpoint) |

Rules the port follows:

- Slugs that maki builds in (e.g. `anthropic`) are skipped — credentials for them are still
  ported, writing `[slug] api_key = "…"` for maki's built-in provider.
- Slugs already present in `providers.toml` are skipped, and the existing file is never rewritten:
  the port only appends a marker comment and new tables, so hand-written entries, comments and
  ordering survive. Running it twice adds nothing.
- The result is exactly what a port means for maki: run `/reload` or restart maki afterwards.

## Files

- `server.ts` — registers the provider, aggregates the per-machine port over the host RPC below.
- `src/host.ts` — the `bb.host` artifact: the wrapped provider bridge and the port handler.
- `src/bridge.ts` — wraps the SDK ACP bridge and intercepts only `provider/installation/*`.
- `src/maki-maintenance.ts` — maki install/update status, GitHub latest-version cache.
- `src/opencode-port.ts` — reads opencode's config/auth, transforms and merges into maki TOML.
- `app.tsx` — the Settings section with the port button.

`npm test` covers the port transformation and the bridge interception.
