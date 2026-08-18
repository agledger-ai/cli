# Changelog

All notable changes to the AGLedger CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-08-18

### Added

- **`--idempotency-key` on `agledger api`, and a generated key on every POST.** The CLI could not send an `Idempotency-Key` at all, so a write retried after a timeout or a dropped connection created a second record rather than replaying the first. Every POST now carries a generated key, which makes a single invocation replay-safe on its own. Pass `--idempotency-key` to reuse the first attempt's key when you are retrying a call that may already have reached the Server: the Server returns the original result instead of recording the work twice. The key binds to method, route and body, so a retry that changes the body is rejected rather than silently replaying the old response. Scoped to POST because that is what the engine arms: all 18 routes that opt into idempotency are POST, and the header is ignored elsewhere. `--dry-run` names the key it would send.

### Fixed

- **Object query parameters reached the wire as `[object Object]`.** The client ran every query value through `String(value)`, so `agledger api GET /v1/records/search` with a `criteria` or `metadata` filter returned 400 rather than filtering. Objects now expand into the API's bracket notation (`metadata[state]=blocked`), and a `Date` serializes as ISO-8601 rather than the JS locale form the date-time params reject. Found by driving the CLI against a live API.

### Changed

- `@agledger/verify-core` moves to `^1.4.0`. The declared range was `^1.3.0` while the lockfile pinned 1.3.0, so CI tested against a build without the ES256 verification floor while a fresh install resolved 1.4.0. Lockfile refreshed, which also clears a high-severity `nanoid` advisory in the dev tree (vitest -> vite -> postcss; never shipped in the tarball).

## [1.3.1] - 2026-08-07

### Fixed

- **`--dry-run` no longer reports a server the real call refuses to use.** agents#105 removed the `https://agledger.example.com` placeholder from `createApiClient`, but its sibling `resolvedAuth`, which is the only thing `--dry-run` prints, kept its own copy. With no URL configured, `agledger api GET /v1/records --dry-run` reported `apiUrl: https://agledger.example.com` and exited 0, while the identical invocation without `--dry-run` exited 2 with `CONFIG_ERROR`. The one job of a dry run is to say what the real call would do, and it was naming a host the real call will not contact and the user never configured. It now reports `apiUrl: null` plus an `apiUrlSource` line naming the error the real call raises.

- **The credential-precedence documentation no longer promises a default API URL.** The README, the `createApiClient` doc comment, and `SKILL.md` all ended the API-URL chain with "> default", left over from before agents#105. There is no default; the chain ends at the stored profile and a call with nothing configured exits 2. `SKILL.md` additionally called `AGLEDGER_API_URL` "Optional", and it ships inside the tarball as the agent-facing description of this CLI, so that was the copy an agent was most likely to act on.

### Changed

- **`Dry run:` replaces `Dry run —` in the non-JSON header line.** Cosmetic; `--json` output is unaffected.

### Packaging

- **Source maps are no longer published.** `dist/**/*.map` shipped with `sources` pointing at `../src/*.ts` and no `sourcesContent`, and `src/` is not in the tarball, so they resolved to nothing. This was roughly half the tarball's file count. The build no longer emits them at all, so no shipped `.js` or `.d.ts` carries a `sourceMappingURL` comment pointing at a map the tarball does not contain (agents#114).
- **`bugs` added to package.json.**

## [1.3.0] - 2026-08-07

### Changed

- **Public discovery paths no longer require a key.** `docs`, `discover`, and `agledger api GET` against `/health`, `/llms.txt`, `/llms-full.txt`, `/openapi.json`, `/docs`, `/v1/conformance` and `/.well-known/*` now send the request with no Authorization header instead of refusing client-side with `AUTH_REQUIRED`. The Server answers all of these unauthenticated, so an agent holding only a URL previously had to shell out to curl for exactly the bootstrap arc the product optimizes for, and `discover` could not do what its own description ("Call this first") promised. Only GET qualifies, so this can never wave through a write, and the Server stays the authority: a path that starts requiring auth simply answers 401 (agents#104).
- **No placeholder API URL.** The built-in default was `https://agledger.example.com`, which resolves nowhere, so a first run with no configuration failed with a DNS error against a host the user never named and was told to check a variable they never set. A missing URL now fails immediately with `CONFIG_ERROR` and says what to pass. Exit code is 2, the existing usage-error code (agents#105).
- **`NETWORK_ERROR` names the URL it tried and the underlying cause.** `fetch failed` is undici's generic text: DNS failure, connection refused, and TLS problems all printed identically. The message now carries the target and the cause code, with a suggestion tailored to `ENOTFOUND` and `ECONNREFUSED` (agents#105).
- **`CHAIN_KEY_NOT_YET_ACTIVE`** is reported by `agledger verify` for an entry written before its signing key's activation, via `@agledger/verify-core` 1.3.0; `CHAIN_KEY_EXPIRED` now means the retirement side only (agents#112).

### Fixed

- **README Quick Start and two `api --help` examples returned 400.** They built criteria as `task_description`; both seeded contracts (`notarize-generic-v1`, `principal-gate-generic-v1`) require `summary`, so the first documented write failed against the shipped server. Both forms are now verified to run against a live instance (agents#106).
- **`verify` no longer borrows the `api` command's recovery text.** Its read and parse failures suggested `--input` and `--data`, flags `verify` does not have (agents#107).
- **An unknown command gives a nearest match and a way forward** instead of a bare "not found": a did-you-mean, a pointer to `list-commands`, and a note that `agledger api` reaches every route (agents#107).

### Documentation

- Exit code **1** is documented as the catch-all it is: an API error whose status maps to nothing more specific (a 400) exits 1, as does a chain that fails `verify`. Read the `code` field to tell them apart, and treat any non-zero as failure rather than keying on 1 (agents#107).

## [1.2.0] - 2026-08-05

Signing-agility wave 2.

### Added

- **`verify` handles ES256 chains** via `@agledger/verify-core` 1.2.0 (dispatch bound to the trusted key's SPKI; unsupported algorithms still fail closed as `CHAIN_UNSUPPORTED_ALGORITHM`).

### Changed

- **Conformance corpus regenerated from engine 1.3.4 @ `ed3369ab`** (export slice, including the ES256 wave).

## [1.1.0] - 2026-08-05

### Changed

- **`agledger verify` takes `@agledger/verify-core` `^1.1.0`, the verifier forward-compatibility floor.** Algorithm dispatch binds to the trusted verification key rather than the unverified protected header; tampered or missing header `alg` values fail as `CHAIN_ALG_MISMATCH`, a key algorithm beyond the build fails closed as `CHAIN_UNSUPPORTED_ALGORITHM`, the signature-covered kid is cross-checked against `signingKeyId` (`CHAIN_SIGNING_KEY_DRIFT`), and untagged COSE_Sign1 is rejected. Legitimate Ed25519 exports verify identically; the new codes render through the existing failure output with their canonical suggestions.
- Conformance vectors refreshed from engine 1.3.4.

## [1.0.6] - 2026-07-20

### Fixed

- `help-json <command>` now surfaces a flag's short alias as `char` (cross-repo #100). The `-F` alias on `agledger api --field` has always worked, but the discovery schema listed only the long form, so a doc showing `-F key=val` could not be verified against `help-json`. Flags without a short alias omit `char`.

## [1.0.5] - 2026-07-16

Docs and tooling. No command, output, or behavior change.

### Changed

- README corrections (cross-repo #99): dropped the drift-prone "250+ routes" claim in favor of a parity statement, the `agledger_discover` quickstart string now leads with notarize, and removed the phantom "fulfill" endpoint and "Layer 3" framing along with stale naming history.
- Refreshed the lockfile to in-range latest (`@agledger/verify-core` 1.0.2, oclif, and dev tooling).
- Upgraded the TypeScript devDependency to `^7.0.2`. Build (including the `oclif manifest` regeneration), typecheck, and tests all pass under 7.0.2.

## [1.0.4] - 2026-06-29

### Changed

- Docs only: removed em-dashes from the README prose and the package.json description (cross-repo #98 writing-style sweep). Rewrote each sentence rather than swapping the glyph. No command, output, or behavior change.

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
