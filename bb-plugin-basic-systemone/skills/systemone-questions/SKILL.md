---
name: systemone-questions
description: Run SystemOne decision-model queries with `bb systemone question` for the Basic SystemOne plugin. Use when the user supplies a full SystemOne request payload to run, asks the designated decision model a question, or wants a decision-model response captured to stdout or a file.
---

# SystemOne questions

`bb systemone question` posts one full SystemOne decision-model request to
the designated endpoint and echoes the structured response JSON to stdout
for capture. The payload is the complete request and stays authoritative;
when it omits `model`, the designated decision model fills it in.

This skill does not describe the request's structure. The request comes from
the user's instructions or another skill; send it exactly as given and do
not invent question types, criteria, or fields.

## Commands

| Command | Effect |
| --- | --- |
| `bb systemone question '<request JSON>'` | Post the full request given inline as one JSON argument. |
| `bb systemone question -f <path>` | Post the request loaded from a JSON file. |
| `bb systemone model show` | Check whether SystemOne is enabled before asking. |

Useful options: `--json` prints the response as one line (default is
pretty-printed; both are valid JSON for capture), `--timeout <duration>`
raises the wait (default 60s).

## Procedure

1. Check the designation first: `bb systemone model show`. If it reports
   SystemOne disabled, follow the systemone-model skill to designate a
   provider and decision model — do not ask a question while disabled.
2. Take the full request payload from the user's instructions (or a file
   they point to). Do not modify it; the payload is authoritative.
3. Run it:
   - Short payloads: pass the JSON as one quoted argument —
     `bb systemone question '{"model":"d1.2", …}'`. Quote carefully; the
     argument is one JSON object.
   - Long or generated payloads: write the JSON to a file and use
     `bb systemone question -f /tmp/request.json` (absolute path; `-f` reads
     the file on the invoking thread's host).
4. Capture stdout — it is the response JSON and nothing else. Parse it; do
   not reformat it for the user unless asked.

## Failures

Failures exit non-zero and print a readable message on stderr; with `--json`
they add a `{ok:false, error:{code, message, hint}}` envelope on stdout.
Codes you will see:

| Code | Meaning | What to do |
| --- | --- | --- |
| `systemone_disabled` | No provider + model designated | `bb systemone model show`, then the systemone-model skill |
| `invalid_payload` | The argument was not a JSON object with a `questions` object | Fix the quoting or the file; the payload must be the complete request |
| `invalid_request` (HTTP 422) | The endpoint rejected the payload | Report the endpoint's detail; do not guess fixes |
| `auth_failed` (HTTP 401/403) | Credentials rejected | Re-set the key with `model set --api-key-stdin` |
| `rate_limited` (HTTP 429) | Too many requests | Wait, then retry |
| `timeout` / `network_error` | Endpoint unreachable or slow | Check the endpoint (local: is `llama serve` running?) |
| `endpoint_unresolved` | The designation has no base URL | `model set` again with `--base-url` |

## Rules

- Ask through this command only; do not call the decision endpoint directly.
- One command run per request; to ask several questions about one state,
  use the multi-question request the payload already contains rather than
  repeated calls.
- Never echo the API key: the command reads it from settings, so it should
  never appear in argv, output, or a transcript.
