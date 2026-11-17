# bb-plugin-basic-systemone

The foundation plugin for the SystemOne Decision Model workflow: designate a
provider + decision model, then ask it typed questions over the
[SystemOne API](https://docs.liquid.ai/api/reference/decision-models/make-decisions)
from the `bb systemone` CLI. Headless by design — no UI, no agent tools yet.
Other plugins build on it through this one's RPC contract.

## The gate

Settings hold the designation: a **provider** and a **decision model**.
Until both are set, **every** SystemOne feature is disabled —
`bb systemone question` refuses with `systemone_disabled`, and the plugin's
RPC `ask` fails the same way. Only `model` selection commands stay available,
because they are how you choose the model.

## Settings

| Setting | Meaning |
| --- | --- |
| `providerId` | Provider serving the decision model (`liquid`, `llama-server`, a BB catalog id, or any custom id) |
| `modelId` | Decision model id, exactly as the provider lists it (`d1.2`, `d1-2b`, …) |
| `baseUrl` | Optional SystemOne base URL override, ending before `/v1/systemone` |
| `apiKey` | Optional Bearer key for the decision endpoint (secret; stored server-side) |

The CLI drives all of it (`bb systemone model …`); the Settings → Installed
plugins pane and `bb plugin config basic-systemone set <key> <value>` work
too.

## The CLI

```sh
bb systemone model show                       # designation + gate state
bb systemone model list-providers             # the models-dropdown source
bb systemone model list-models <providerId>   # one provider's decision models
bb systemone model set <providerId> <modelId> [--base-url <url>] [--api-key-stdin]
bb systemone model clear                      # disable everything again
bb systemone question '<full request JSON>'   # ask; echoes the response JSON
bb systemone question -f /tmp/request.json    # same, payload from a file
```

- The `question` payload is the **full** SystemOne request and is forwarded
  exactly as given; the designated model fills in `model` only when the
  payload omits it.
- Success echoes the response JSON on stdout (`--json` for one line) and
  nothing else, so a bb process can capture it.
- Failures exit non-zero with a readable message on stderr; `--json` adds
  the `{ok:false, error:{code,message,hint}}` envelope on stdout.

Decision-model providers out of the box:

| Provider | Endpoint | Auth |
| --- | --- | --- |
| `liquid` | `https://api.liquid.ai/decisions` | Bearer `LIQUID_API_KEY` |
| `llama-server` | `http://127.0.0.1:9931` (llama.cpp `llama serve`) | none |

Anything else works with `--base-url` (and `--api-key-stdin` when the
endpoint needs a key): a self-hosted decision server behind an OpenCode
provider, a gateway, a tunnel — anything speaking the SystemOne API at
`<base>/v1/systemone`.

## The library (RPC)

Other plugins call this one instead of re-implementing the workflow —
`bb.sdk.plugins.callRpc({ pluginId: "basic-systemone", method, input })`
with the matching output schema:

| Method | Input → output |
| --- | --- |
| `status` | `null` → `{ enabled, disabledReason, providerId, modelId, baseUrl, baseUrlSource, requestUrl, apiKeySet }` |
| `ask` | `{ request, timeoutMs? }` → `{ response, modelId, requestUrl }` |
| `listProviders` | `null` → `{ providers: [{ id, displayName, source, decisionEndpoint, available, notes }] }` |
| `listModels` | `{ providerId }` → `{ providerId, models: [{ id, description, releaseDate, inputModalities }] }` |

`ask` throws (error envelope carries the code) on the gate, a rejected
payload, or an upstream failure — the same codes the CLI reports.
Discover the contract with `bb plugin rpc`.

## Skills

Two bundled skills cover the whole workflow without teaching the request
schema — the payload structure comes from the user's own instructions or
additional skills they provide:

- **systemone-model** — designate, inspect, switch, or clear the provider +
  model; API keys always via `--api-key-stdin`.
- **systemone-questions** — check the gate, run inline or `-f` payloads,
  capture stdout, and read the failure codes.

## Roadmap

- UI for the designation (the `list-providers` / `list-models` data already
  backs a models dropdown).
- Higher-level question tools for agents, on top of `ask`/`question`.
- More provider profiles as decision models appear in provider catalogs
  (OpenRouter, OpenCode Zen, …).

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest run (dm.test.ts: gate, request prep, HTTP mapping)
npm run build       # bb plugin build
bb plugin install /path/to/bb-plugin-basic-systemone
```
