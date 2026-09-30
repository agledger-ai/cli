# AGLedger CLI

Thin cover over the AGLedger API. The CLI passes your call through to the API and forwards the response. No flag-to-body translation, no drift.

## Setup
Credentials resolve per command with this precedence: `--api-key` flag > `AGLEDGER_API_KEY` env > `AGLEDGER_OIDC_TOKEN_CMD` > `AGLEDGER_OIDC_TOKEN_FILE` > stored profile (after `agledger login`). API URL: `--api-url` flag > `AGLEDGER_API_URL` env > stored profile URL.

OIDC instead of an API key: set `AGLEDGER_OIDC_TOKEN_CMD` to a command that prints an OIDC JWT from your identity provider, or `AGLEDGER_OIDC_TOKEN_FILE` to a file holding one (optional `AGLEDGER_OIDC_AGENT_ID`, an assertion only: the token decides the agent, and a different id, or any id on a token bound to no agent, is 403 `CERT_AGENT_BINDING_MISMATCH`; bind the agent with `PATCH /v1/agents/{id}` and `oidcIss`/`oidcSub`, or `claimMapping.agent_id` on the trusted issuer). The CLI exchanges a fresh token for a short-lived cert on each invocation, signs request bodies with a key held only in memory, and re-exchanges on expiry or a 401. `agledger auth` shows the cert identity; `--verbose` names the credential source on stderr. Failures: `OIDC_TOKEN_SOURCE_FAILED` (exit 3, names the variable, carries the command's stderr) and `OIDC_EXCHANGE_FAILED` (forwards the Server error and its `recoveryHint`).

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
- `agledger verify <audit-export.json> --trust-anchor sha256:<digest>`: verify a record audit export offline (COSE_Sign1 envelopes per RFC 9052, hash chain + envelope signatures, Ed25519 or ES256). No network, no API key. `--trust-anchor` (repeatable) is the SPKI digest of a vault key taken out of band (the installer prints the first one); the signed key statements in the export are walked from it. Exit 0 if valid, 1 if broken; `--json` for structured output. `--distrusted-key sha256:<digest>[@<instant>]` (repeatable, needs `--trust-anchor`) mirrors the operator's `VAULT_DISTRUSTED_KEYS`; `--keys <file>` supplies keys (a saved `GET /v1/verification-keys` response works as is); `--require-key-id <id>` rejects exports signed by an unexpected key; `--require-supplied-keys` refuses the export's own embedded keys.

**Read the verdict, not just the exit code.** Without `--trust-anchor` a chain that verifies prints `UNANCHORED`, exits 0, and its JSON carries `keyTrust.status: "no_anchor"`: the signatures were checked against keys nobody pinned, and a key written into the Server's database alone would pass. Only `PASS` (`keyTrust.status: "walked"`) says the keys are linked to one you trust.

**What verification proves:**
- Every entry was signed by a key listed in the export (or supplied via `--keys`) at the moment the vault wrote it, and, with `--trust-anchor`, that key is linked by signed key statements to the one you pinned (else `CHAIN_SIGNING_KEY_UNANCHORED`).
- Payloads have not been altered since signing (SHA-256 recomputation matches the stored `payload_hash` over the signed COSE_Sign1 bytes).
- The hash chain is contiguous: no entries were inserted, removed, or reordered between positions.
- On failure, `brokenAt.code` is a canonical SCREAMING_SNAKE failure code (e.g. `CHAIN_HASH_MISMATCH`, `CHAIN_SIGNATURE_INVALID`, `CHAIN_SIGNING_KEY_UNANCHORED`, and at position 0 `KEY_STATEMENT_INVALID`, `KEY_CLOSURE_INVALID`, `CHAIN_KEY_WINDOW_DRIFT`).

**What verification does NOT prove:**
- That the signing key is *legitimate* without `--trust-anchor`. `/v1/verification-keys` and `/.well-known/scitt-keys` are served from the same database; the export's `exportMetadata.anchoredFrom` is the Server's own claim. Pin a digest you took out of band.
- That the export is *complete*. A vault operator can still truncate the export at either end.
- That the *content* the payload describes actually happened. Payloads record what the agent notarized (declared intent and reported result); the verifier checks tamper-evidence, not whether the work occurred.

## Agent-native patterns
- `--json` on every command (auto when piped)
- `--quiet` for exit-code-only operation
- `--dry-run` on `agledger api` shows the request without sending
- `--paginate` on GET follows cursors, streams NDJSON
- Structured errors on stderr: the CLI's own are `{code, message, suggestion, ...}`; an API error is the Server's RFC 9457 body, verbatim, with its text in `detail`
- Semantic exit codes (0-10)

## Credentials
- `agledger login --api-key <key> [--profile NAME]`: verifies key, stores in `~/.agledger/config.json` (0600). After login, plain `agledger api ...` calls authenticate from the stored profile (no flag/env needed).
- `agledger login --oidc --oidc-token-cmd <command> | --oidc-token-file <path> [--oidc-agent-id ID] [--profile NAME]`: stores the source (never a token, cert or key). A command is verified first with one exchange; a file is only checked to hold a JWT, since exchanging it would spend the token until the file rotates.
- `agledger config use <profile>`: set the active profile; `agledger api ... --profile NAME` uses a specific one per-invocation.
- `agledger logout [--profile NAME | --all]`
- `agledger config list | get | use <profile> | path`
- `agledger auth`: check login state and identity, including the OIDC cert (exit 0 when nothing is configured)
