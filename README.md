# @agledger/cli

The official CLI for the [AGLedger](https://agledger.ai) API — accountability infrastructure for AI agents. The Layer 3 accountability layer of the agent stack.

A **thin cover** over the API. The CLI passes your request straight through to the API and forwards the response — no hand-coded per-endpoint wrappers, no flag-to-body translation, no drift. Every AGLedger API route is reachable via `agledger api <METHOD> <path>`.

**Learn more**

- [agledger.ai](https://agledger.ai) — what AGLedger is and why Layer 3 accountability matters
- [How it works](https://agledger.ai/how-it-works) — the four-endpoint lifecycle: record, receipt, verdict, fulfill
- [Glossary](https://agledger.ai/glossary) — canonical definitions of Record, Receipt, Verdict, Settlement Signal
- [API reference](https://agledger.ai/api) — every endpoint the CLI covers
- [Documentation](https://agledger.ai/docs) — installation and integration guides

## Install

```bash
npm install -g @agledger/cli
```

## Quick Start

```bash
export AGLEDGER_API_KEY=agl_adm_...
export AGLEDGER_API_URL=https://your-agledger-instance

# Check health, identity, scopes, and get the quickstart workflow
agledger discover

# List Record types
agledger api GET /v1/schemas

# Create a record (raw JSON body)
agledger api POST /v1/records --data '{
  "type": "ACH-PROC-v1",
  "criteria": { "item_spec": "500 units copper wire", "quantity": { "target": 500 } }
}'

# Or build the body with typed fields
agledger api POST /v1/records \
  -F type=ACH-PROC-v1 \
  -F criteria.item_spec='500 units copper wire' \
  -F criteria.quantity.target=500

# Submit a receipt
agledger api POST /v1/records/<record-id>/receipts \
  --data '{"evidence":{"items_delivered":"copper wire","quantity_delivered":500}}'

# Render a verdict
agledger api POST /v1/records/<record-id>/outcome \
  -F receiptId=<receipt-id> -F outcome=PASS
```

## Why a thin cover?

- **Zero drift.** When the API adds, renames, or removes a route, the CLI keeps working — no code change required.
- **One mental model.** The API docs are the CLI docs. What you read in the OpenAPI spec is what you type.
- **All 250+ routes on day one.** You get full parity, not a hand-picked subset.

## Ways to pass a body

| Flag | When to use |
|---|---|
| `--data '{...}'` | Agent-friendly: one JSON string |
| `--input file.json` | Complex payloads; reuse files |
| `--input -` | Pipe JSON from stdin |
| `-F key=value` (repeatable) | Shell-friendly; typed (`true`/`false`/`null`/numbers); nested via `a.b=v`; arrays via `arr[]=v`; JSON literals via `k={...}` / `k=[...]` |

Merging order (low → high): `--data` → `--input` → `-F` → `--query`. Later sources override earlier keys.

## Agent-native DX

- `--json` on every command (auto when stdout is piped)
- `--quiet` suppresses output (exit code only)
- `--dry-run` on `agledger api` shows the request without sending
- `--paginate` on GET follows cursor pagination and streams NDJSON
- Structured errors on stderr: `{error: true, code, message, suggestion, ...}` — API errors pass through verbatim
- Semantic exit codes: 0 (OK), 2 (usage), 3 (auth), 4 (forbidden), 5 (not found), 6 (conflict), 7 (rate limit), 8 (server), 9 (network), 10 (timeout)
- `NO_COLOR` supported per [no-color.org](https://no-color.org)

## Discovery

```bash
agledger list-commands --json          # 9 CLI-local commands
agledger help-json api --json          # Schema for `api` (args + flags)
agledger discover                       # Health + identity + quickstart
agledger api GET /openapi.json          # Full API route catalog
```

## CLI-local commands (everything else is `agledger api`)

| Command | Purpose |
|---|---|
| `api` | Call any API endpoint |
| `discover` | Health + identity + scopes + quickstart |
| `login` | Verify API key, store in `~/.agledger/config.json` (0600) |
| `logout` | Remove profile(s) |
| `auth` | Check current login state (exit 0 either way) |
| `config` | `list` / `get` / `use <profile>` / `path` |
| `verify` | Offline audit export verification (hash chain + Ed25519, no network) |
| `list-commands` | Inventory (this list) |
| `help-json` | Per-command schema |

## Authentication

```bash
# Verifies the key against the API, stores under ~/.agledger/config.json
agledger login --api-key agl_adm_... --profile prod

# Switch profiles
agledger config use prod

# Or just use env vars per-invocation
AGLEDGER_API_KEY=... AGLEDGER_API_URL=... agledger api GET /v1/records
```

Agent keys (`agl_agt_*`) and admin keys (`agl_adm_*`) are both accepted — the API routes them appropriately.

## Requirements

- Node.js >= 22.0.0
- A running [AGLedger API](https://www.agledger.ai) instance

## License

Proprietary. Copyright (c) 2026 AGLedger LLC. All rights reserved. See [LICENSE](LICENSE).
