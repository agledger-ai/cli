# AGLedger CLI

Accountability and audit infrastructure for AI agents.

## Setup
Requires: `AGLEDGER_API_KEY` env var or `--api-key` flag.

## Workflow
Follow these steps to track accountability for your work:
1. `agledger schema list` — see available contract types
2. `agledger schema get <type>` — see required fields and examples
3. `agledger mandate create --type <type> --data '{"criteria":{...}}'` — create a mandate
4. `agledger receipt submit <mandateId> --data '{"evidence":{...}}'` — submit evidence when done
5. `agledger verdict render <mandateId> PASS --reason "..."` — record the outcome

## Discovery
- `agledger list-commands --json` — full command inventory
- `agledger help-json <command>` — per-command schema with args and flags

## Key patterns
- `--json` on every command (auto when piped)
- `--all` streams NDJSON through all pages
- `--dry-run` on mutating commands
- Structured errors on stderr with semantic exit codes (0-10)
- Error responses include `suggestion` field with recovery guidance
