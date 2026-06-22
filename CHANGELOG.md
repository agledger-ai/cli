# Changelog

All notable changes to the AGLedger CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.3] - 2026-06-22

### Fixed

- **`agledger auth` reported not-authenticated right after a successful `login`** (cross-repo #94). The status check looked only at the `--api-key` flag / `AGLEDGER_API_KEY` env var, ignoring the credential `login` writes to a stored profile in `~/.agledger/config.json` — so the first command a new user runs to confirm setup said it failed when it hadn't. `auth` now resolves the key with the same precedence as every other command (flag → env → active stored profile) and reports the resolving `source` (and `profile`, when applicable). A keyless machine still reports `authenticated: false` with exit 0. Validated end-to-end against a live API v1.0.3.

## [1.0.2] - 2026-06-20

### Changed

- Bumped `@agledger/verify-core` to `^1.0.0` (now GA at 1.0.0 alongside the API and the published package line). No CLI-surface or behavior changes — the offline `verify` command's logic is unchanged. `oclif.manifest.json` regenerated.

## [1.0.1] - 2026-06-10

### Changed

- **License re-sync.** `LICENSE` is now a verbatim copy of the canonical AGLedger SDK license template **v1.5**: §7 trademarks trimmed to **AGLedger + Settlement Signal (pending)** (removed the retired "Agentic Ledger" / AOAP claims), §6 export language modernized to ENC §740.17(b)(1) mass-market self-classification, and §1 carries the no-inspection / no-training / no-usage-data representation.
- No code changes; republished so the distributed tarball carries the corrected license text.

## [1.0.0] - 2026-06-08

General-availability release, tracking AGLedger API **v1.0.0 GA**. The CLI is a thin pass-through over the API, so the surface is unchanged. **Includes the 0.8.10 fixes below** — 0.8.10 was tagged but never reached npm (its release run failed at the SBOM-pack step before publishing), so those changes ship for the first time here.

### Fixed

- Release pipeline: the SBOM "pack tarball" step now takes only the last line of `npm pack` output (`prepack` runs `oclif manifest`, which prints to stdout), fixing the multiline `$GITHUB_OUTPUT` failure that blocked the 0.8.10 publish.

## [0.8.10] - 2026-06-04

### Fixed

- **Stored login profiles now actually authenticate API calls.** Credentials previously resolved only from the `--api-key` flag / `AGLEDGER_API_KEY` env — the profile written by `agledger login` / `config use` was never read back, so authenticated calls after a login failed with `AUTH_REQUIRED`. Credentials now resolve with precedence **`--api-key` flag > `AGLEDGER_API_KEY` env > stored profile**, and the API URL with **`--api-url` flag > `AGLEDGER_API_URL` env > stored profile URL > default**. `--profile <name>` selects a specific stored profile for any command. `agledger api --dry-run` now echoes the resolved auth (URL, source, masked key).

### Changed

- **`User-Agent` is derived from the package version** instead of a hardcoded literal (was the stale `agledger-cli/0.8.8`).

### Security

- `ApiClient` rejects protocol-relative request paths (`//host/...`), which `new URL(path, base)` would otherwise resolve to an attacker-controlled host. Any base-URL path prefix (e.g. an API-gateway mount point) is now preserved instead of being dropped.

### Docs

- Corrected the CLI-local command count (9 → 10) and added the `docs` command to the README command table; clarified the Authentication sections to describe the now-working profile flow and the credential precedence.

## [0.8.9] - 2026-06-04

No functional change. First release published from CI with **build provenance** via npm trusted publishing (OIDC) — npm attaches a Sigstore provenance attestation automatically; verify with `npm audit signatures`. A CycloneDX SBOM is attached to the release. This package now lives in its own source-of-truth repo `agledger-ai/cli` and resolves `@agledger/verify-core@0.1.4`.

## [0.8.8] - 2026-06-02

### Security

- `agledger api <METHOD> <path>` now rejects a `path` containing control characters (`\x00`–`\x1f`, `\x7f`) before building the request URL. Agent-supplied paths are untrusted input; control characters enable request-line / header injection and never appear in a legitimate API path. Returns `INVALID_PATH` (exit 2) with a recovery hint.

## [0.8.7] - 2026-05-29

Closes [agledger-agents#85 (F-732)](https://github.com/agledger-ai/agledger-agents/issues/85).

### Added

- **`agledger docs [--full]`** — fetches the API's agent-oriented documentation narrative (`/llms.txt`, or `/llms-full.txt` with `--full`). `discover` and `list-commands` now point at it.

### Fixed

- **`verify --keys` accepts the raw `GET /v1/verification-keys` envelope.** That endpoint returns `{ data: [...], ... }`, not the bare array the `--help` text promised; the CLI now unwraps `.data` automatically (a bare `[{keyId, publicKey}]` list or a `{keyId: base64}` map still pass through untouched). Help text corrected.
- **Clearer signature label on a broken chain.** An entry whose signature was never reached because of an upstream chain break now reports `signature: "not-checked"` instead of the ambiguous `"skipped"` (via `@agledger/verify-core@^0.1.3`).
- Corrected the stale `agledger-cli/0.7.0` User-Agent string to the real version.

## [0.8.6] - 2026-05-28

### Changed

- Republished against `@agledger/verify-core` 0.1.2 — picks up F-698 OOB-key polymorphism and the temporal-axis fix. `agledger verify --keys vault-keys.json` now accepts either form of the keys file: the compact `{keyId: SPKI-DER-base64}` map (what the docs showed) OR the natural list shape returned by `GET /v1/verification-keys` (i.e. dump the response's `.data` array to a file and pass it directly). Help text updated.
- Malformed `--keys` files now produce the CLI's structured error envelope (`{code: "INVALID_JSON_INPUT", message, suggestion}` on stderr, exit 2) instead of an unhandled `TypeError` stack trace. Agents parsing stderr can now self-correct rather than asking the user.

## [0.8.5] - 2026-05-28

### Changed

- Republished against `@agledger/verify-core` 0.1.1. `agledger verify` now exercises `oidc_actor` and `key_temporal` on exports from engine ≥ v0.26.x (the wire now carries `actorOidcIss/Sub/Synthesized` and `signingKeyWindows`); the `--json` result reports these as `applied` instead of `skipped_no_input` for those exports. Older exports without the new fields continue to report them as `skipped_no_input`.

## [0.8.4] - 2026-05-27

Verifier consolidation (Pass 1). `agledger verify` now runs on the shared verification core `@agledger/verify-core` instead of a CLI-local copy — the same hash-chain + COSE_Sign1 + Ed25519 logic the SDK, MCP server, and `@agledger/verify` share.

### Changed

- Offline verifier failure reasons are now canonical SCREAMING_SNAKE `FailureCode` values from `@agledger/verify-core` (surfaced on the `--json` output).
- New `--require-out-of-band-keys` flag: fail closed unless every signature is verified against a caller-supplied (out-of-band) key, rejecting keys embedded in the export. For high-assurance audits.

## [0.8.3] - 2026-05-27

### Fixed

- **`agledger verify` rejected valid exports (F-682).** The offline verifier read the legacy `position` field on each export entry, but current exports (v0.25+) emit `chainPosition`. With `position` absent, every valid export failed with a false `position_gap` on the first entry. Now reads `chainPosition` with a `position` fallback for pre-v0.25 exports. Verified end-to-end against a live export (valid → exit 0, tampered → exit 1).

## [0.8.2] - 2026-05-27

Tracks AGLedger API v0.25.5 (Verify → Gate rename). The CLI is a thin pass-through, so the renamed routes (`/outcome` → `/verdict`, `/verify` → `/evaluate`, `/verification-status` → `/gate-status`) reach `agledger api <METHOD> <path>` automatically — no functional change. The `agledger verify` command (offline COSE_Sign1 audit verification) is cryptographic and unchanged.

### Fixed

- README: the verdict example now uses `POST /v1/records/{id}/verdict` with `-F verdict=accept` (was the retired `/outcome` route with `outcome=PASS`).

## [0.8.1] - 2026-05-21

Tracks AGLedger API v0.24.0. CLI is a thin pass-through, so the v0.24.0 rename sweep (`tenant`/`enterprise` → `org`, account-deactivation split, federation surface trim) lands automatically on `agledger api <METHOD> <path>` — no flag changes. Internal updates:

### Changed

- Offline verifier (`agledger verify`): `RecordAuditExport.exportMetadata.enterpriseId` → `orgId` to match v0.24.0 export shape.
- Example paths in `--help` and `base.ts` updated from the retired `/federation/v1/register` to `/federation/v1/peer`.

## [0.8.0] - 2026-05-19

Tracks AGLedger API v0.23.0. SCITT vocabulary alignment + canonical COSE_Sign1 chain envelope cutover. The CLI is a thin pass-through, so most of the wave shows up as text changes — but the offline verifier (`agledger verify`) is a full rewrite. Closes cross-repo issue agledger-agents#68.

### Changed (BREAKING — offline verifier: format 1.0 → 2.0)

- `agledger verify <export.json>` now decodes canonical COSE_Sign1 envelopes (RFC 9052, tag 18, EdDSA) over in-toto v1 Statement payloads, deterministic CBOR per RFC 8949 §4.2.1. Replaces the JCS + detached-Ed25519 verifier from 0.7.x.
- Exit codes unchanged (0 = valid, 1 = invalid chain or signature, 2 = usage error).
- New `EntryFailureReason` values surfaced on the `--json` output: `cose_decode_failed`, `cose_header_mismatch`. Old reasons retained but `signature_invalid` now refers to the COSE_Sign1 signature.
- `--json` output now carries a `signatureCoverage` discriminator (`{ signed, unsigned, skipped, total }`) so auditors can tell "hash chain valid + 0 entries signed" from "chain valid + every entry signed." Do NOT conclude "Ed25519-verified" from `valid: true` alone — read `signatureCoverage`.
- New `chainIntegrityReason: "payload_drift"` — emitted when the visible `payload` jsonb diverges from the predicate signed in `coseSign1` (a privileged-DBA-bypass tamper of the denormalized view).
- The verifier picks up a `cborg` runtime dependency. Same lib the engine uses on the write side — keeps the two implementations byte-compatible.
- Pre-1.0 export-format JSON (`exportFormatVersion: "1.0"`) is rejected with `unsupported_algorithm`. Re-export the chain from a v0.23.0+ engine.

### Changed (text only — Receipt → Completion alignment)

- `agledger discover` quickstart step 4: "Submit a receipt when done" → "Submit a completion when done"; path `/v1/records/{id}/receipts` → `/v1/records/{id}/completions`.
- `agledger list-commands` note text: "records, receipts, schemas, webhooks" → "records, completions, schemas, webhooks".
- `agledger verify` description: "RFC 8785 + Ed25519" → "COSE_Sign1 envelope (RFC 9052) + Ed25519".

The CLI is a pure pass-through over `agledger api <METHOD> <path>`, so the API-side renames (route paths, request/response field names, webhook event names, scopes) all surface verbatim without flag changes. Customers writing scripts against `agledger api POST /v1/records/{id}/receipts` need to update the path to `/v1/records/{id}/completions`.

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
