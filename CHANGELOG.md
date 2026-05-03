# Changelog

All notable changes to the AGLedger CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.2] - 2026-05-02

Resolves cross-repo issue agledger-agents#63.

### Fixed
- **`agledger discover` no longer advertises `/docs` unconditionally.** The hardcoded `swaggerUi: 'Your instance serves interactive Swagger UI at /docs.'` line was misleading on instances with `SWAGGER_UI_ENABLED=false` (the production default). API v0.22.17 added a 302 redirect at `/docs` so the URL no longer 404s, but the CLI's discover hint still pointed operators at the wrong place. Customers who need the API reference should hit `GET /openapi.json` (always-on) — already documented in the same response.

## [0.7.1] - 2026-04-30

Tracks AGLedger API v0.22.13. Thin pass-through, so no surface changes — `agledger api` reaches all 10 new v0.22.x routes (tenant string overrides, federation gateway status, agents directory, vault checkpoints, dispute withdraw) with no flag work needed.

## [0.7.0] - 2026-04-27

Tracks AGLedger API v0.21.5. Every `/v1/mandates/*` route is now `/v1/records/*`; `Contract Type` is `Type`. The CLI is a thin pass-through, so this release sweeps docs/examples and the offline verifier's field names.

### Changed (BREAKING)

- **Offline verifier output field rename.** `verify-export.ts` exports `RecordAuditExport` (was `MandateAuditExport`). Metadata fields: `mandateId` → `recordId`, `contractType` → `type`. `VerifyExportResult.mandateId` → `recordId`. Crypto primitives (RFC 8785 JCS, SHA-256, Ed25519) and the signature input `{position}:{payloadHash}:{previousHash}` are unchanged.
- **`agledger verify` output line.** Reads `PASS  Record: REC_123` (was `Mandate: …`).
- **`agledger verify` error hint** points at `GET /v1/records/{id}/audit-export`.

### Changed (docs/examples sweep)

- All `agledger api` examples in `--help`, `SKILL.md`, and `README.md` updated: `/v1/mandates` → `/v1/records`, `contractType` → `type`.
- `list-commands` note updated: "For API operations (records, receipts, schemas, webhooks, ...)".
- `--help` argument description: example paths read `/v1/records`.
- README API-key prefix examples updated to `agl_adm_*` / `agl_agt_*`.

### Build

- `prebuild` now wipes `dist/` so the oclif manifest never picks up stale command files from prior builds.
