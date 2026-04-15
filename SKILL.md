# AGLedger CLI

Accountability and audit infrastructure for AI agents.

## Setup
Requires: `AGLEDGER_API_KEY` env var or `--api-key` flag.

## Discovery
- `agledger list-commands --json` — full command inventory
- `agledger help-json "mandate create"` — per-command schema

## Examples
```bash
agledger mandate list --status ACTIVE --json
agledger mandate create --type ACH-PROC-v1 --data '{"criteria":{"item":"widgets"}}'
agledger receipt submit MANDATE_ID --data '{"agentId":"agent-1","evidence":{"delivered":true}}'
agledger verdict render MANDATE_ID PASS --reason "Delivered as requested"
agledger audit trail MANDATE_ID
```

## Key patterns
- `--json` on every command (auto when piped)
- `--all` streams NDJSON through all pages
- `--dry-run` on mutating commands
- Structured errors on stderr with semantic exit codes (0-10)
