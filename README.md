# @agledger/cli

The official CLI for the [AGLedger](https://agledger.ai) API: change control for AI agents. Agent memory, approvals, audit trail, and notifications: one API, one signed ledger, self-hosted.

A **thin cover** over the API. The CLI passes your request straight through to the API and forwards the response: no hand-coded per-endpoint wrappers, no flag-to-body translation, no drift. Every AGLedger API route is reachable via `agledger api <METHOD> <path>`.

**Learn more**

- [agledger.ai](https://agledger.ai): what AGLedger is and who needs it
- [How it works](https://agledger.ai/how-it-works): the record, completion, and verdict lifecycle
- [Glossary](https://agledger.ai/glossary): canonical definitions of Record, Completion, SCITT Receipt, Verdict, Settlement Signal
- [API reference](https://agledger.ai/api): every endpoint the CLI covers
- [Documentation](https://agledger.ai/docs): installation and integration guides

## Install

```bash
npm install -g @agledger/cli
```

## Quick Start

```bash
export AGLEDGER_API_KEY=agl_agt_...
export AGLEDGER_API_URL=https://your-agledger-instance

# Check health, identity, scopes, and get the quickstart workflow
agledger discover

# List Record types
agledger api GET /v1/schemas

# Create a record (raw JSON body). Types are customer-registered; a fresh org
# is seeded with `notarize-generic-v1` (and 3 other editable samples).
# `criteria` is validated against the JSON Schema you registered for the type.
agledger api POST /v1/records --data '{
  "type": "notarize-generic-v1",
  "criteria": { "summary": "summarize Q3 filings" }
}'

# Or build the body with typed fields. Use -f for a value that must stay a
# string: the Server does not coerce a JSON body, so an all-digit identifier
# passed with -F is sent as a number and refused.
agledger api POST /v1/records \
  -F type=notarize-generic-v1 \
  -F criteria.summary='summarize Q3 filings' \
  -f externalTaskId=4821

# A type with a completion phase, such as the seeded principal-gate-generic-v1,
# takes a Completion once the record is ACTIVE; autoActivate gets it there on
# create. Note the `id` it returns.
agledger api POST /v1/records \
  -F type=principal-gate-generic-v1 \
  -F criteria.summary='deliver 500x copper wire' \
  -F autoActivate=true

# Submit a completion. The principal then renders a Verdict (accept / reject)
# on the Completion; use the route documented in the API
# (see `agledger api GET /openapi.json`).
agledger api POST /v1/records/<record-id>/completions \
  --data '{"evidence":{"summary":"delivered 500x copper wire","evidenceUrl":"https://orders.example.com/CW-500"}}'
```

## Why a thin cover?

- **Zero drift.** When the API adds, renames, or removes a route, the CLI keeps working, no code change required.
- **One mental model.** The API docs are the CLI docs. What you read in the OpenAPI spec is what you type.
- **Every API route on day one.** You get full parity, not a hand-picked subset.

## Ways to pass a body

| Flag | When to use |
|---|---|
| `--data '{...}'` | Agent-friendly: one JSON string |
| `--input file.json` | Complex payloads; reuse files |
| `--input -` | Pipe JSON from stdin |
| `-F key=value` (repeatable) | Shell-friendly; typed (`true`/`false`/`null`/numbers); nested via `a.b=v`; arrays via `arr[]=v`; JSON literals via `k={...}` / `k=[...]` |
| `-f key=value` (repeatable) | Same, but the value is taken verbatim as a string |

Merging order (low → high): `--data` → `--input` → `-F`/`-f` → `--query`. Later sources override earlier keys.

### `-F` types the value; `-f` does not

The Server does not coerce the fields of a JSON body, so a field declared
`string` refuses a number. `publisher`, `platformRef`, `projectRef`,
`externalTaskId` and `correlationId` are plain strings that carry identifiers
minted by other systems, and those are frequently all digits:

```bash
agledger api POST /v1/records -F type=notarize-generic-v1 -F criteria.summary=x -F externalTaskId=4821   # sends 4821, refused
agledger api POST /v1/records -F type=notarize-generic-v1 -F criteria.summary=x -f externalTaskId=4821   # sends "4821"
```

Reach for `-f` rather than quoting. Shell quotes that survive into the value
(`-F externalTaskId='"4821"'`) reach the Server as a string with the quote
characters inside it, and the Server accepts that: the Record is notarized,
signed and immutable, with an identifier no other system will match.

## Agent-native DX

- `--json` on every command (auto when stdout is piped)
- `--quiet` suppresses output (exit code only)
- `--dry-run` on `agledger api` shows the request without sending
- `--verbose` on every command reports which credential was used, and each OIDC cert exchange, as JSON lines on stderr; it never prints a key, token or cert
- `--paginate` on GET follows cursor pagination and streams NDJSON
- Every POST carries a generated `Idempotency-Key`, so one invocation is replay-safe on its own. Retrying a call that may already have reached the Server? Pass `--idempotency-key` with the first attempt's key and the Server replays the original result instead of recording the work twice
- Structured errors on stderr: `{error: true, code, message, suggestion, ...}`; API errors pass through verbatim
- Semantic exit codes: 0 (OK), 1 (general), 2 (usage), 3 (auth), 4 (forbidden), 5 (not found), 6 (conflict), 7 (rate limit), 8 (server), 9 (network), 10 (timeout). **1 is the catch-all**: an API error whose status maps to nothing more specific (a 400, for example) exits 1, as does a chain that fails `agledger verify`. Read the `code` field on stderr to tell them apart, and treat any non-zero as failure rather than keying on 1 alone.
- `NO_COLOR` supported per [no-color.org](https://no-color.org)

## Discovery

```bash
agledger list-commands --json          # 10 CLI-local commands
agledger help-json api --json          # Schema for `api` (args + flags)
agledger discover                       # Health + identity + quickstart
agledger api GET /openapi.json          # Full API route catalog
```

## CLI-local commands (everything else is `agledger api`)

| Command | Purpose |
|---|---|
| `api` | Call any API endpoint |
| `discover` | Health + identity + scopes + quickstart |
| `login` | Verify an API key (or, with `--oidc`, an OIDC token source) and store it in `~/.agledger/config.json` (0600) |
| `logout` | Remove profile(s) |
| `auth` | Check current login state and show the identity, including the OIDC cert (exit 0 when nothing is configured) |
| `config` | `list` / `get` / `use <profile>` / `path` |
| `verify` | Offline audit export verification (COSE_Sign1, RFC 9052; Ed25519 or ES256; no network). `--agent-keys <file>` re-verifies the agent signatures sealed on the chain against the cert keys you supply |
| `docs` | Fetch the API's agent-oriented narrative (`llms.txt` / `--full`) |
| `list-commands` | Inventory (this list) |
| `help-json` | Per-command schema |

## Authentication

```bash
# Verifies the key against the API, then stores it under ~/.agledger/config.json (0600)
agledger login --api-url https://your-agledger-instance --api-key agl_agt_... --profile prod

# Switch the active profile; subsequent commands use its key automatically
agledger config use prod

# Run a one-off against a specific stored profile
agledger api GET /v1/records --profile prod

# Or pass credentials per-invocation via env or flags (no stored profile needed)
AGLEDGER_API_KEY=... AGLEDGER_API_URL=... agledger api GET /v1/records
```

### OIDC: no stored secret

An agent can authenticate with a token from your own identity provider instead
of an API key. The CLI runs a token source you name, exchanges the token at
`POST /v1/auth/oidc/cert` for a short-lived cert the Server signs, and sends
that cert as the bearer. Your operator first registers the IdP as a trusted
issuer on the Server.

| Variable | What it holds |
|---|---|
| `AGLEDGER_OIDC_TOKEN_CMD` | A shell command whose stdout is an OIDC JWT, run on every exchange: `gcloud auth print-identity-token`, `az account get-access-token`, `vault`, `kubectl create token`, or your own script |
| `AGLEDGER_OIDC_TOKEN_FILE` | A file holding an OIDC JWT, read on every exchange, such as a projected service-account token that Kubernetes rotates on disk. The Server exchanges each token once, so one file token serves one CLI run until the file rotates; for repeated runs, prefer a command that mints a new token |
| `AGLEDGER_OIDC_AGENT_ID` | Optional. The agent the cert binds to, when the token does not map to one itself |

```bash
unset AGLEDGER_API_KEY   # an API key outranks a token source
export AGLEDGER_API_URL=https://your-agledger-instance
export AGLEDGER_OIDC_TOKEN_CMD='gcloud auth print-identity-token --audiences=agledger'

# Shows the account and the cert the Server issued: agent, issuer, subject, scopes, expiry
agledger auth

# Every call now exchanges a fresh token for a cert; nothing is written to disk
agledger api POST /v1/records -F type=notarize-generic-v1 -F criteria.summary='nightly reconciliation'

# Or store the token source (never a token) in a profile
agledger login --oidc --oidc-token-cmd 'gcloud auth print-identity-token --audiences=agledger' --profile work
```

What the CLI does with it:

- **A fresh token per exchange.** The Server accepts each token id once, so the source is called again for every exchange and a token is never reused or cached.
- **The key stays in memory.** Each invocation generates an Ed25519 key pair, proves possession of it in the exchange, and discards it on exit. The cert and the key are never written anywhere; `login --oidc` stores only the command or the file path. A token command is verified at login with one exchange; a token file is only checked to hold a JWT, because exchanging it would spend the token the next command needs until the file rotates.
- **Signed writes.** Every request with a body carries `X-Agent-Signature` over the SHA-256 of the exact bytes sent, so the chain entry records the agent's own signature in `on_behalf_of.agent_signature`, not only the Server's.
- **Refresh.** The cert is re-exchanged once half its lifetime has passed, and once more if the Server answers 401 to it, before the error is reported.
- **Failures name the source.** A token command that exits non-zero fails with `OIDC_TOKEN_SOURCE_FAILED` (exit 3), naming the variable and carrying the command's stderr. A refused exchange fails with `OIDC_EXCHANGE_FAILED` and forwards the Server's error, including its `recoveryHint`.
- **`--verbose`** prints which credential a command used and each exchange (cert id, agent, subject, expiry) as JSON lines on stderr. It never prints a key, token or cert.

### Working on behalf of someone

When the work is done for a person or another party rather than for the agent itself, give the CLI the RFC 8693 delegation token your IdP's token exchange issued (it must carry an `act` claim naming the agent). The CLI sends it as `AGLedger-On-Behalf-Of` on every POST, beside its own credential, and the Server seals the delegation into the signed chain entry: `bound` when the CLI authenticates through an OIDC cert whose subject is the token's `act`, `unbound` on an API key.

| Variable | What it holds |
|---|---|
| `AGLEDGER_ON_BEHALF_OF_CMD` | A shell command whose stdout is the delegation token |
| `AGLEDGER_ON_BEHALF_OF_FILE` | A file holding the delegation token |

The command wins over the file. The Server never deduplicates a delegation token, so one is reused until shortly before its `exp` and then read again; one with no `exp` is read again for every request, and one already expired is refused before it is sent. If the Server refuses the delegation token, the source is read once more and the request retried. It never appears in output, errors or `--verbose`, which names only the variable in use.

```bash
export AGLEDGER_ON_BEHALF_OF_CMD='your-idp-token-exchange --subject alice@example.com --actor my-agent'
agledger api POST /v1/records -F type=notarize-generic-v1 -F criteria.summary='expense report for alice'
```

**Credential precedence** (highest first), applied per command:

- **Credential:** `--api-key` flag → `AGLEDGER_API_KEY` env → `AGLEDGER_OIDC_TOKEN_CMD` → `AGLEDGER_OIDC_TOKEN_FILE` → stored profile (`--profile <name>`, else the active profile), whose API key or OIDC token source is used. `AGLEDGER_OIDC_AGENT_ID` overrides a profile's stored agent id.
- **API URL:** `--api-url` flag → `AGLEDGER_API_URL` env → stored profile URL. There is no default: AGLedger is self-hosted, so a call with no URL from any of those three sources exits 2 with `CONFIG_ERROR` rather than guessing a host.

So once you `agledger login`, plain `agledger api ...` calls authenticate from the stored profile with no flags or env. `--dry-run` echoes the resolved auth (URL, source, masked key, or the name of the OIDC token source, which it does not run) so you can confirm which credentials a call would use without sending it; when no URL is configured it reports `apiUrl: null` and names the error the real call would raise.

Agent keys (`agl_agt_*`) and admin keys (`agl_adm_*`) are both accepted; the API routes them appropriately.

## Requirements

- Node.js >= 24.0.0
- A running [AGLedger API](https://www.agledger.ai) instance

## License

Proprietary. Copyright (c) 2026 AGLedger LLC. All rights reserved. See [LICENSE](LICENSE).
