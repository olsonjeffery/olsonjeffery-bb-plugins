# Changelog

## 0.1.0 — 2026-11-17

Initial release: the SystemOne Decision Model foundation, headless.

- Settings designate one provider + decision model; until both are set every
  SystemOne feature is disabled.
- `bb systemone model` — show, set (with `--base-url`, `--api-key-stdin`),
  clear, `list-providers` (built-in profiles + BB's provider catalog), and
  `list-models`.
- `bb systemone question` — post the full SystemOne request (inline or
  `-f <file>`), echo the structured response JSON to stdout.
- Built-in profiles: `liquid` (api.liquid.ai, Bearer key) and
  `llama-server` (local llama.cpp `llama serve`); any other SystemOne
  endpoint works with `--base-url`.
- Discoverable RPC contract (`status`, `ask`, `listProviders`, `listModels`)
  for plugins built on top of this one.
- Skills: systemone-model, systemone-questions.
