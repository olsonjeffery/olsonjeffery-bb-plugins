---
name: systemone-model
description: Designate, inspect, or clear the provider and decision model for the SystemOne plugin with the `bb systemone model` CLI. Use when asked to set up, switch, check, or disable the decision model, or when a `bb systemone` command reports that SystemOne is disabled.
---

# SystemOne model designation

The Basic SystemOne plugin answers typed questions with a decision model over
the SystemOne API. One provider + one decision model is designated at a time.
Until both are designated, every SystemOne feature is disabled — including
`bb systemone question` and any tool another plugin builds on it.

## Commands

| Command | Effect |
| --- | --- |
| `bb systemone model show` | Show the designated provider, model, endpoint, and auth state. |
| `bb systemone model list-providers` | List built-in decision-model providers and BB's provider catalog. |
| `bb systemone model list-models <providerId>` | List the decision models one provider exposes. |
| `bb systemone model set <providerId> <modelId>` | Designate the provider and model. |
| `bb systemone model clear` | Clear the designation; everything stops until a model is set again. |

Add `--json` to any command when the output drives code (questions use a
separate command; see the systemone-questions skill).

## Options for `model set`

- `--base-url <url>` — the SystemOne base URL, ending before
  `/v1/systemone`. Required for any provider without a built-in decision
  endpoint (the built-in profiles are `liquid` and `llama-server`).
- `--api-key-stdin` — pipe the endpoint's Bearer API key in, so it never
  appears in argv or a transcript:
  `printf '%s\n' "$LIQUID_API_KEY" | bb systemone model set liquid d1.2 --api-key-stdin`
- `--clear-api-key` — forget the stored key.

## Procedure

1. Run `bb systemone model show` first. If it reports SystemOne enabled, ask
   the user before changing the designation.
2. Pick the provider with `bb systemone model list-providers`; use the exact
   ids it prints, never a guessed one.
3. List that provider's models with
   `bb systemone model list-models <providerId>` and pick a decision model
   from its output (catalog providers can list hundreds; `--limit` bounds it).
4. Designate it, e.g.
   `bb systemone model set liquid d1.2 --api-key-stdin` with the key piped
   in, or
   `bb systemone model set llama-server d1-2b` for a local `llama serve`.
5. Confirm with `bb systemone model show`.

## Rules

- Do not set a provider or model the user did not ask for, and do not clear
  an existing designation without the user asking.
- Never write the API key into the command line, a file in the repo, or the
  transcript; only `--api-key-stdin` carries it.
- Catalog providers (BB's provider directory, e.g. `pi`) have no built-in
  decision endpoint: they need `--base-url` plus, when the endpoint needs
  one, `--api-key-stdin`.
- A failed `bb systemone question` with `systemone_disabled` means the
  designation is missing or was cleared — run `bb systemone model show`,
  then follow the Procedure above.
