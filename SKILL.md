# AGLedger CLI

Thin cover over the AGLedger API. The CLI passes your call through to the API and forwards the response — no flag-to-body translation, no drift.

## Setup
Requires: `AGLEDGER_API_KEY` env var or `--api-key` flag. Optional: `AGLEDGER_API_URL`.

## Primary command: `agledger api`
Call any API endpoint:

```
agledger api <METHOD> <PATH> [--data JSON | --input FILE | -F key=value ...]
```

## Workflow (start here)
1. `agledger discover` — health, identity, scopes, quickstart steps.
2. `agledger api GET /v1/schemas` — list contract types.
3. `agledger api GET /v1/schemas/{contractType}` — required fields + examples.
4. `agledger api POST /v1/mandates --data '{"contractType":"...","criteria":{...}}'` — create a mandate.
5. `agledger api POST /v1/mandates/{id}/receipts --data '{"evidence":{...}}'` — submit receipt when done.
6. Every API response includes `nextSteps` — follow them.

## Ways to pass a body
- `--data '{"k":"v"}'` — raw JSON string (agent-friendly)
- `--input file.json` — read JSON from file
- `--input -` — read JSON from stdin
- `-F key=value` — repeatable; types parsed (`true`/`false`/`null`/numbers); nested via `a.b=v`; arrays via `arr[]=v`

## Discovery commands
- `agledger list-commands --json` — full CLI inventory (8 commands)
- `agledger help-json <command> --json` — per-command schema with args and flags
- `agledger api GET /openapi.json` — full API route catalog

## Agent-native patterns
- `--json` on every command (auto when piped)
- `--quiet` for exit-code-only operation
- `--dry-run` on `agledger api` shows the request without sending
- `--paginate` on GET follows cursors, streams NDJSON
- Structured errors on stderr: `{code, message, suggestion, ...}`
- Semantic exit codes (0-10)

## Credentials
- `agledger login --api-key <key> [--profile NAME]` — verifies key, stores in `~/.agledger/config.json` (0600)
- `agledger logout [--profile NAME | --all]`
- `agledger config list | get | use <profile> | path`
- `agledger auth` — check login state (exit 0 whether logged in or not)
