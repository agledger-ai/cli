# AGLedger CLI

Thin cover over the AGLedger API. The CLI passes your call through to the API and forwards the response. No flag-to-body translation, no drift.

## Setup
Credentials resolve per command with this precedence: `--api-key` flag > `AGLEDGER_API_KEY` env > stored profile (after `agledger login`). API URL: `--api-url` flag > `AGLEDGER_API_URL` env > stored profile URL.

**There is no default API URL, and it is not optional.** AGLedger is self-hosted, so the CLI has no server to guess. If none of those three sources supplies one, the command exits 2 with `CONFIG_ERROR` rather than calling a placeholder host.

## Primary command: `agledger api`
Call any API endpoint:

```
agledger api <METHOD> <PATH> [--data JSON | --input FILE | -F key=value | -f key=value ...]
```

## Workflow (start here)
1. `agledger discover`: health, identity, scopes, quickstart steps.
2. `agledger api GET /v1/schemas`: list Record types.
3. `agledger api GET /v1/schemas/{type}`: required fields + examples.
4. `agledger api POST /v1/records --data '{"type":"...","criteria":{...}}'`: create a record.
5. `agledger api POST /v1/records/{id}/completions --data '{"evidence":{...}}'`: submit completion when done.
6. Every API response includes `nextSteps`. Follow them.

## Ways to pass a body
- `--data '{"k":"v"}'`: raw JSON string (agent-friendly)
- `--input file.json`: read JSON from file
- `--input -`: read JSON from stdin
- `-F key=value`: repeatable; types parsed (`true`/`false`/`null`/numbers); nested via `a.b=v`; arrays via `arr[]=v`
- `-f key=value`: same, value taken verbatim as a string. Required for identifiers that look numeric (`externalTaskId`, `correlationId`, `platformRef`, `projectRef`, `publisher`): the Server does not coerce a JSON body, so `-F externalTaskId=4821` sends a number and is refused. Do not quote around `-F` to work around it; the quote characters land inside the notarized value.

## Discovery commands
- `agledger list-commands --json`: full CLI inventory (10 commands)
- `agledger help-json <command> --json`: per-command schema with args and flags
- `agledger api GET /openapi.json`: full API route catalog

## Offline audit verification
- `agledger verify <audit-export.json>`: verify a record audit export offline (COSE_Sign1 envelopes per RFC 9052, hash chain + envelope signatures, Ed25519 or ES256). No network, no API key. Exit 0 if valid, 1 if broken; `--json` for structured output; `--keys <file>` supplies keys out of band (merged over any embedded in the export); `--require-key-id <id>` rejects exports signed by an unexpected key; `--require-out-of-band-keys` refuses the export's own embedded keys for an independent audit.

**What verification proves:**
- Every entry was signed by a key listed in the export (or supplied via `--keys`) at the moment the vault wrote it.
- Payloads have not been altered since signing (SHA-256 recomputation matches the stored `payload_hash` over the signed COSE_Sign1 bytes).
- The hash chain is contiguous: no entries were inserted, removed, or reordered between positions.
- On failure, `brokenAt.code` is a canonical SCREAMING_SNAKE failure code (e.g. `CHAIN_HASH_MISMATCH`, `CHAIN_SIGNATURE_INVALID`).

**What verification does NOT prove:**
- That the signing key is *legitimate*. Obtain the key out of band from `/.well-known/scitt-keys` on the issuing instance (or the `/v1/verification-keys` API) and pass it via `--keys --require-out-of-band-keys`.
- That the export is *complete*. A vault operator can still truncate the export at either end.
- That the *content* the payload describes actually happened. Payloads record what the agent notarized (declared intent and reported result); the verifier checks tamper-evidence, not whether the work occurred.

## Agent-native patterns
- `--json` on every command (auto when piped)
- `--quiet` for exit-code-only operation
- `--dry-run` on `agledger api` shows the request without sending
- `--paginate` on GET follows cursors, streams NDJSON
- Structured errors on stderr: `{code, message, suggestion, ...}`
- Semantic exit codes (0-10)

## Credentials
- `agledger login --api-key <key> [--profile NAME]`: verifies key, stores in `~/.agledger/config.json` (0600). After login, plain `agledger api ...` calls authenticate from the stored profile (no flag/env needed).
- `agledger config use <profile>`: set the active profile; `agledger api ... --profile NAME` uses a specific one per-invocation.
- `agledger logout [--profile NAME | --all]`
- `agledger config list | get | use <profile> | path`
- `agledger auth`: check login state (exit 0 whether logged in or not)
