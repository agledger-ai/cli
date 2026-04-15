# @agledger/cli

The official CLI for the [AGLedger](https://agledger.ai) API -- accountability and audit infrastructure for agentic systems.

54 commands across 10 topics. Designed for both human developers and AI agents.

## Install

```bash
npm install -g @agledger/cli
```

## Quick Start

```bash
# Authenticate
export AGLEDGER_API_KEY=ach_ent_...
export AGLEDGER_API_URL=http://localhost:3000

# Create and activate a mandate
agledger mandate create --type ACH-PROC-v1 --activate \
  --data '{"enterpriseId":"...","contractVersion":"1","platform":"cli","criteria":{"item_spec":"500 units copper wire","quantity":{"target":500,"unit":"units"}}}'

# Submit a receipt
agledger receipt submit <mandate-id> \
  --data '{"item_secured":"Copper wire","quantity":500,"total_cost":{"amount":1150,"currency":"USD"},"supplier":{"id":"SUP-001","name":"Acme Wire Co"},"confirmation_ref":"PO-2026-0042"}'

# Render a verdict
agledger mandate outcome <mandate-id> --receipt-id <receipt-id> --outcome PASS
```

## Agent-Native Design

The CLI is designed for AI agent consumption:

- **`--json`** on every command, auto-JSON when piped (non-TTY)
- **`--quiet`** for exit-code-only operation
- **`--dry-run`** on all mutating commands
- **Structured errors** to stderr with `code`, `message`, `suggestion`
- **Semantic exit codes** (0-10) for programmatic handling
- **Three-tier discovery**: `SKILL.md` (~50 tokens) -> `list-commands --json` -> `help-json <command>`
- **Never prompts interactively** -- fails with structured error

## Discovery

```bash
# List all commands (~700 tokens)
agledger list-commands --json

# Get per-command schema (~200 tokens)
agledger help-json "mandate create" --json
```

## Topics

| Topic | Commands | Description |
|-------|----------|-------------|
| mandate | 12 | Create, activate, transition, batch, chain, counter-propose, outcome |
| schema | 16 | Contract type CRUD, diff, import/export, compatibility checking |
| receipt | 3 | Submit evidence, list, get |
| webhook | 3 | Create, list, delete |
| audit | 2 | Trail (per-mandate), events (enterprise-wide) |
| agent | 2 | List agents, reputation history |
| verdict | 1 | Render principal verdict |
| federation | 6 | Gateway management, health, audit log |
| admin | 3 | Enterprise/agent creation, config |

## Authentication

Set `AGLEDGER_API_KEY` environment variable or pass `--api-key` flag:

```bash
export AGLEDGER_API_KEY=ach_ent_...   # Enterprise key
export AGLEDGER_API_KEY=ach_age_...   # Agent key (auto-routes to agent endpoints)
```

Agent keys (`ach_age_*`) automatically route mandate creation to `POST /v1/mandates/agent`.

## Requirements

- Node.js >= 22.0.0
- A running [AGLedger API](https://agledger.ai) instance

## License

Proprietary. Copyright (c) 2026 AGLedger LLC. All rights reserved. See [LICENSE](LICENSE).
