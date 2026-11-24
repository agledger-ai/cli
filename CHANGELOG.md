# Changelog

All notable changes to the AGLedger CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.2.0] - 2026-11-18

### Added

- **`--output <file>` on `agledger api`.** A text response, such as the `html`, `csv` or `ndjson` audit export, is now printed or written exactly as the Server sent it. It was printed as a JSON object wrapping an escaped string. The `format=html` audit export of AGLedger Server 3.0.0 comes out as the page itself.
- **`agledger verify --allow-after-retirement`.** A sealed federation message signed more than 300 seconds after its key's retirement now fails `CHAIN_FEDERATION_WIRE_INVALID`, as verify-core 2.2.0 holds it; the flag accepts and counts it, as `agledger-verify` does.
- **`agledger verify --expected-entry-count <n>`.** Holds an export to an entry count taken out of band. The counts an export states are unsigned, so an export cut from the end with them deleted used to exit 0; with the flag it fails `CHAIN_POSITION_GAP`. The `Entry count` line names the count, and suggests the flag when there was none.
- **`--agent-keys-file` on `login --oidc`, and `AGLEDGER_AGENT_KEYS_FILE`.** Each command exchanges for a cert under a key pair of its own, and only the public half of that pair re-verifies the agent signature it seals, so a CLI agent's signatures could never be verified offline. Every exchange now adds its `publicKeyJwk` (with the cert id, agent and lifetime) to the named JWK Set before the cert is used; pass the file to `agledger verify --agent-keys`. A file that is not a `{"keys":[...]}` set is left alone and the command exits 1 `FILE_WRITE_ERROR` before anything is signed. Commands running at once can share one file: each adds its key under `<file>.lock`, and one that cannot take the lock within 15 seconds exits 1 `FILE_WRITE_ERROR` naming it. `login --oidc` and `auth` also print the cert's `publicKeyJwk`.
- The README shows the request fields and filters of AGLedger Server 3.0.0 through `agledger api`: `producedBy` on a record or completion, `traceId`, `originRecordId`, `producedBy[...]` and the numeric `criteriaGt/Gte/Lt/Lte` and `metadataGt/Gte/Lt/Lte` bounds on search, `GET /v1/records/counts`, and `signatureMeaning` on a verdict (accepted only on an ephemeral OIDC cert; an API key gets a 422).

### Changed

- **`agledger verify` exits with the codes `agledger-verify` uses.** A run given a `--trust-anchor` that ends `unanchored` exits 3 instead of 0, and an untampered export checked against another Server's pin exits 3 (`NOT ANCHORED`, `verdict: "unanchored"`) instead of 1. Exit 1 is kept for a `failed` verdict. The command makes no network call, so 3 here is never an auth failure.
- A malformed `--idempotency-key`, and `--paginate` with `--output`, exit 2 with `INVALID_FIELD` (they reported `MISSING_INPUT` and `INVALID_METHOD`).
- **`agledger verify` runs on `@agledger/verify-core` 2.2.0 and allows 300 seconds at each edge of a key's window for a sealed federation message.** A message signed within that margin of a key change was failed or reported as after retirement; it now verifies on the key it names. The `--federation-key-history` help says so.
- **The CLI no longer depends on oclif.** Commands, flags, aliases, defaults, environment fallbacks and exit codes are unchanged. Argument parsing is Node's own `util.parseArgs`, and the runtime dependency tree went from 41 packages to 2 (`@agledger/verify-core` and its `cborg`).
- **A command line the parser refuses is a JSON error on stderr, exit 2**: an unknown flag, a flag missing its value, a missing or extra argument, a value outside the allowed list. The body is `{"error":true,"code":"USAGE_ERROR","message":...,"suggestion":...}`, the same shape as every other CLI error, and `--quiet` still writes nothing.
- `--help` is laid out by the CLI itself: description, usage, arguments, every flag with its `[env: ...]` and `[default: ...]`, and examples, wrapped at the terminal width. `--version` prints the platform as Node reports it (`linux-x64`).
- Help and README text no longer point at tooling or documents that are not published.
- **`agledger verify` fails an export cut from the end.** Fewer entries than `exportMetadata.expectedEntries` is `CHECKPOINT_ROW_MISSING`, and fewer than `exportMetadata.totalEntries` is `CHAIN_POSITION_GAP`. The human report has an `Entry count` line, and `--json` carries `entryCount`. An export that verified on 2.1.0 with its tail removed now fails.
- Commands that make no API call (`config`, `logout`, `list-commands`, `help-json`) no longer list the credential flags in `--help`; the flags are still accepted.
- `--idempotency-key` help says what a 409 `IDEMPOTENCY_KEY_IN_FLIGHT`, a 409 `IDEMPOTENT_WRITE_COMMITTED` and a 503 `SERVER_SHUTTING_DOWN` ask of the caller.

### Fixed

- **A query parameter nested below the bracket form is refused, and nothing is sent.** `-F a.b=v` becomes `a[b]=v`; `-F a.b.c=v` or an object inside an array was sent as `[object Object]`. It now exits 2 with `INVALID_FIELD`.
- **Global flags before the command work.** `agledger --json api GET /health` and `agledger --quiet api ...` used to fail.
- **A corrupt `~/.agledger/config.json` is an error, not an empty store.** It was read as having no profiles, so the next `login` overwrote the file and lost every profile. A file that does not parse now exits 2 `CONFIG_ERROR` and is left alone. The file is written through a temporary file and a rename, and the directory is set to 0700 even when it already existed.
- `login --api-key NEW` without `--api-url` keeps the stored profile's URL instead of dropping it.
- A profile name such as `toString` or `__proto__` names no profile.
- `--paginate` on a response with no `data` array exits 2 `NOT_PAGINATED` instead of printing nothing and exiting 0; `--paginate` with `--output` is refused.
- **`--output` is checked before the request is sent.** An unwritable path, a directory or an empty value exits 2 without sending, so a POST is no longer applied and then lost to a failed file write. If the write still fails afterwards, the response body is printed to stdout and the error carries the `idempotencyKey`.
- A reader that closes the pipe (`agledger api GET /v1/records --paginate | head -1`) ends the command quietly with code 0 instead of printing a stack trace.
- **`-F` types a number only when it prints back as typed.** `0123`, `-0`, `1.0` and `12345678901234567890` stay strings; they used to reach the Server as `123`, `0`, `1` and `12345678901234567000`. Use `-f` for an identifier that must stay a string.
- A query the request cannot carry is refused, and `--dry-run` shows what is sent: `-F status=null` on a GET and a non-object `--data` on a GET or DELETE exit 2 `INVALID_FIELD`.
- **`-F a=1 GET /health` parses.** `-F` and `-f` take following words only while they are shaped `key=value`, and a flag such as `--dry-run` ends the run.
- An API URL with a user name or password (`http://user:pw@host`) exits 2 `CONFIG_ERROR` with the URL redacted; the password used to be echoed.
- `--idempotency-key` with a newline, a non-printable character, no characters or more than 256 is a usage error (exit 2).
- `-h` and `agledger help [command]` print help. `--help` is not read as a request for help when it is the value of a flag (`--data --help`) or follows `--`.
- **`npm pack` on an installed copy of the package no longer deletes its `dist/`.** Packing an installed copy (to vendor it, or to mirror it for an air-gapped install) left the package without its code. `prepack` now builds only in a source checkout.

## [2.1.0] - 2026-11-05

### Added

- **`--federation-key <hubId>=<key>` on `verify`.** Each sealed peer message is held to its body hash and its entry, and a message from a hub whose federation key you give is also re-verified under it. A bad value is a usage error before the export is read; a sealed message that does not hold fails `CHAIN_FEDERATION_WIRE_INVALID`. `--json` carries `federationWire: { present, verified, failed }`, and the human output's `Peer messages` line counts failures apart from messages sent by a hub with no key.
- **`--federation-key-history <file>`**, a peer's `GET /.well-known/agledger-federation-keys.json`, used beside `--federation-key` for its hub. It trusts every key the history links to it, so entries sealed before the peer changed its federation key verify. `federationWire.afterRetirement` counts messages signed under a key the peer had already retired; each message is placed by its signed `wire.timestamp`.
- **`verify` re-binds inlined evidence.** On an export taken with `?evidence=true`, each completion's evidence body and each dispute's filed payload is hashed (SHA-256 over RFC 8785) against the hash its entry signs. An edited body fails `CHAIN_EVIDENCE_BINDING_MISMATCH` where it used to pass; the report gains an `Evidence:` line, and `--json` carries `evidenceBinding`. Needs `@agledger/verify-core` 2.1.0.

### Fixed

- **`--quiet` is exit code only, as the README, SKILL.md and `--help` say.** The error body used to still go to stderr. Under `--quiet` nothing is written on any failure, and the exit code carries the outcome.

### Changed

- The README says the package needs an AGLedger Server 2.0 or later and names the last release for a 1.x Server.

## [2.0.0] - 2026-10-05

Targets AGLedger Server 2.0 only.

### Breaking

- **`--require-out-of-band-keys` is `--require-supplied-keys`.** Behaviour is unchanged. In `--json` output, `keyProvenance.outOfBand` is `keyProvenance.supplied`, `optionalChecks` carries `key_anchoring`, and every result carries `keyTrust`.
- **A chain that verifies without `--trust-anchor` prints `VERIFIED, NOT ANCHORED`, not `PASS`.** It still exits 0, and its JSON carries `verdict: "unanchored"` and `keyTrust.status: "no_anchor"` (a trusted pass is `verdict: "trusted"`, a failure `"failed"`), matching `@agledger/verify` and the Python `agledger-verify`. A run with `--trust-anchor` that verified no signature under an anchored key is also `VERIFIED, NOT ANCHORED` (`keyTrust.status: "no_anchored_signature"`). The human report says nothing failed but this is not a trusted verdict, and without an anchor it names the key the export claims as its Server's and says how to pin one. `PASS` is printed only when every key is linked to your anchor and a signature verified under one.

### Added

- **`agledger verify --trust-anchor sha256:<digest>`** (repeatable) anchors the vault keys to one you obtained out of band: the signed key statements the export carries, plus the `statements` on keys passed with `--keys`, are walked from it. An entry signed by a key the walk does not reach fails `CHAIN_SIGNING_KEY_UNANCHORED`. A key statement that does not hold is reported as `KEY_STATEMENT_INVALID`, `KEY_CLOSURE_INVALID` or `CHAIN_KEY_WINDOW_DRIFT` under `keyTrust.findings`, and the human report prints each finding and says how many keys were anchored.
- **`--distrusted-key sha256:<digest>[@<RFC 3339 instant>]`** (repeatable) mirrors the operator's `VAULT_DISTRUSTED_KEYS`: what such a key signed from the instant counts for nothing. Without `--trust-anchor` it is refused (`MISSING_INPUT`, exit 2). A malformed value, a key named twice, or a key given to both flags with no instant is `INVALID_FIELD`, exit 2. A `--keys` or `--agent-keys` file with a value verify-core refuses is `INVALID_FIELD`; a file that does not exist is `FILE_READ_ERROR`, exit 2. The export path may come before or after these flags, and a missing path is `MISSING_INPUT`. `--distrusted-keys` and `--require-out-of-band-keys` are refused, naming the flag that replaced them.
- **`agledger verify` names the distrust entry an export says the Server applied.** Where a Server's distrusted-key entry cut a key's listed retirement and the run was not given the same `--distrusted-key`, the finding names the entry to confirm with the Server's operator, says when your entry carries another instant, and an earlier instant you gave is a `Key note:`. Verdict and exit code are as before.
- **Findings and notes name the CLI flags** (`--distrusted-key`, `--trust-anchor`, `--require-key-id`, `--require-supplied-keys`) in both human and `--json` output.
- **`agledger verify` reports an unsigned entry written while the vault was signing.** An entry with no signing key fails `CHAIN_ENTRY_UNSIGNED` when an earlier entry in its chain names a key, or when it was written at or after the earliest activation time among the keys the verifier holds. Unsigned history from before the first key stays reduced coverage. An entry that names a key but carries an all-zero signature fails `CHAIN_SIGNATURE_INVALID`. An entry with a missing `createdAt` where the check needs one, or a null payload or key, fails with a code such as `CHAIN_MALFORMED_ENTRY`.
- **`agledger verify` names the entries that carry no signature.** A pass over a chain with unsigned entries prints `Unsigned: N of M entries carry no signature (written before the install registered its first key), so they are covered by the hash chain only.`

### Changed

- **`agledger logout` with no flags removes the active profile.** It used to act on the profile named `default`. `--profile <name>` still names one explicitly. Removing nothing is now an error: a missing profile, or no active profile, exits 2 with `MISSING_INPUT` (was exit 0 with `loggedOut: false`).
- **`--profile` naming no stored profile exits 3 `AUTH_REQUIRED` whatever else is set,** `--dry-run` included. Before, a call with `AGLEDGER_API_KEY` or `--api-key` and a URL ran and ignored the mistyped profile. `login` is the exception, since its `--profile` names the profile it writes.
- **`agledger logout` leaves no profile active after removing the active one.** The output carries `activeProfile: null` and a `note` naming the profiles left and `config use`. `logout --all` with nothing stored exits 2 `MISSING_INPUT`.
- **A POST that times out or loses its connection names the key it sent.** The `TIMEOUT` error, and a `NETWORK_ERROR` after the request went out, carry `idempotencyKey`, and the suggestion is to rerun with `--idempotency-key <key>` so the Server replays the first attempt instead of creating a second record. `--verbose` reports the key every POST goes out under. The wait is `AGLEDGER_TIMEOUT` (seconds, default 30); a value that is not a positive number up to 2147483 exits 2 `CONFIG_ERROR`.
- **A malformed API URL is a configuration error.** A URL from `--api-url`, `AGLEDGER_API_URL` or a stored profile that is not an absolute `http` or `https` URL exits 2 `CONFIG_ERROR`, naming where it came from (was exit 1 `UNKNOWN_ERROR`). `login --oidc` refuses one before running the token source.
- **The API URL is checked before the credential.** A call with neither a URL nor a credential exits 2 `CONFIG_ERROR` (was exit 3 `AUTH_REQUIRED`). A `--profile` naming no stored profile is still reported first.
- `agledger verify` walks an export's key statements in write order, so key-anchoring findings name the statement and a trusted key's later admissions date its window as the Server does. A statement that counts for nothing only because its signer was distrusted after it was written is a `Key note:` rather than a finding, so an honest rotation away from a later-distrusted key still passes pinned on its successor.
- **Error bodies are read through `detail`.** Server 2.0 removed the top-level `message` from error bodies. The CLI's 401 classification and the OIDC exchange error now read `detail` only. API errors still pass through to stderr verbatim; the CLI's own errors keep their `message`.
- **`AGLEDGER_OIDC_AGENT_ID` and `login --oidc-agent-id` are documented as an assertion, not a choice of agent.** The Server binds a cert to the agent the token names. When the id names a different agent, or the token binds none, the exchange is refused with 403 `CERT_AGENT_BINDING_MISMATCH`; a token bound to a federation shadow agent is refused with 403 `SHADOW_AGENT_CERT_FORBIDDEN`. The flag help, README and `SKILL.md` say so and point at binding the agent instead (`PATCH /v1/agents/{id}` with `oidcIss` and `oidcSub`, or `claimMapping.agent_id` on the trusted issuer). A refusal fails with `OIDC_EXCHANGE_FAILED` (exit 4 on a 403) carrying the Server's error body and `recoveryHint` under `apiError`.
- The conformance corpus is regenerated from Server 2.0.0: 35 export vectors, with three new ones covering unsigned entries.

## [1.5.0] - 2026-09-21

### Added

- **`agledger verify` refuses a re-attributed export.** The `actorId`, `actorRole` and `actorOwnerId` an export displays are now cross-checked against the signed actor claim, so an export re-attributed to another actor fails with the new `CHAIN_ACTOR_ATTRIBUTION_MISMATCH`. Requires `@agledger/verify-core` 1.5.0.
- **`agledger verify --agent-keys <file>` re-verifies sealed agent signatures offline.** The file holds the Ed25519 public keys of agent certs (a JWK, a list of JWKs, a `{keys:[...]}` JWK Set, or entries wrapping one as `{publicKeyJwk}`). A mismatch fails the chain as `CHAIN_AGENT_SIGNATURE_INVALID`. The JSON result reports `agentSignatures {present, verified}`. Requires `@agledger/verify-core` 1.5.0.
- **Delegation: `AGLEDGER_ON_BEHALF_OF_CMD` / `AGLEDGER_ON_BEHALF_OF_FILE`.** When set, the CLI sends the RFC 8693 delegation token they yield as `AGLedger-On-Behalf-Of` on every POST, beside its own credential, and the Server seals the delegation into the signed chain entry. The token is reused until shortly before its `exp` and never printed.
- **OIDC token sources: an agent can authenticate with its own identity provider instead of an API key.** Set `AGLEDGER_OIDC_TOKEN_CMD` to a shell command whose stdout is an OIDC JWT (`gcloud auth print-identity-token`, `az account get-access-token`, `vault`, `kubectl create token`, or any script), or `AGLEDGER_OIDC_TOKEN_FILE` to a file holding one, such as a rotated Kubernetes service-account token. `AGLEDGER_OIDC_AGENT_ID` optionally names the agent the cert binds to. The CLI exchanges the token at `POST /v1/auth/oidc/cert` for a short-lived cert and sends it as the bearer. The source is called again for every exchange, because the Server accepts each token id only once, so a token file serves one run until it rotates. Each invocation generates an Ed25519 key pair in memory; neither the key nor the cert is ever written to disk.
- **Signed writes under a cert.** Every request with a body carries `X-Agent-Signature-Content-Hash` and `X-Agent-Signature`, an Ed25519 signature over the SHA-256 of the exact bytes sent, so the chain entry records the agent's own signature.
- **Refresh and retry.** A cert is re-exchanged once half its lifetime has passed. A 401 to a cert bearer triggers one re-exchange and one retry of the same request (same body, same `Idempotency-Key`); a second 401 is reported as the Server sent it.
- **`agledger login --oidc`** verifies a token source with one exchange and a `GET /v1/auth/me`, then stores the source in the profile (`--oidc-token-cmd` or `--oidc-token-file`, each also read from its environment variable, and optionally `--oidc-agent-id`). A token, cert or key is never stored. `config list` and `config get` report which kind of credential a profile holds.
- **`agledger auth` shows the cert identity** when a token source is in use: id, agent, issuer, subject, scopes, and issue and expiry times, beside the `GET /v1/auth/me` account.
- **`--verbose` on every command** reports which credential a command used and each OIDC exchange as JSON lines on stderr. It never prints a key, token or cert.

### Changed

- **Credential precedence** is now: `--api-key` or `AGLEDGER_API_KEY`, then `AGLEDGER_OIDC_TOKEN_CMD`, then `AGLEDGER_OIDC_TOKEN_FILE`, then the stored profile's API key or token source. The no-credential error (`AUTH_REQUIRED`, exit 3) names all three sources.
- `--dry-run` names an OIDC token source (`credential: "oidc-cert"`, `oidcTokenSource`) without running it.
- `discover` checks `/health` without a credential, so a token source or identity provider that is down does not hide whether the Server is up.
- README: the Quick Start uses an agent key, creates the record it completes with `principal-gate-generic-v1` and `autoActivate`, passes `--api-url` in the `login` example, and includes the required fields in the `-F`/`-f` example. Every block was run against a 1.8.0 Server.

### Fixed

- **`--paginate` under an OIDC token source exchanged once per page.** With `AGLEDGER_OIDC_TOKEN_FILE` the second page failed 409. One client now serves the whole invocation.
- **A 401 is renewed according to what it is about.** One naming the delegation token re-reads the delegation source and retries once. One naming `X-Agent-Signature` is reported as it came. Any other 401 on a cert bearer triggers one re-exchange.
- **Cert refresh is timed from local receipt,** so a local clock ahead of the Server no longer re-exchanges on every request. A refresh that fails while the cert is still valid keeps the current cert, backs off, and is reported under `--verbose`.
- **Delegation tokens:** one with no `exp` is read again for every request; one already expired is refused before sending, naming the variable; one with no `sub` gets a delegation-specific error.
- **A token command that times out is killed with its whole process group,** and output past 64 KiB is refused as not one token.
- **`login --oidc --oidc-token-file` no longer spends the token.** It checks the file holds a JWT and saves the profile without exchanging it.

### Security

- **Tokens stay out of output.** A token command that fails exits 3 with `OIDC_TOKEN_SOURCE_FAILED`, naming the variable and carrying the command's stderr with anything shaped like a JWT redacted. Output that is not a JWT is reported by length, never echoed. A refused exchange exits with `OIDC_EXCHANGE_FAILED` and forwards the Server's error body (its `recoveryHint` included) with the token scrubbed out.

## [1.4.1] - 2026-09-10

### Changed

- Upgraded the CLI framework to oclif 5. Commands, flags, help text and exit codes (2 usage, 3 no credentials, 9 unreachable Server) are unchanged.
- LICENSE section 6 names the ciphers this package line ships: Ed25519 (EdDSA), ECDSA P-256 with SHA-256, HMAC-SHA-256, AES-256-GCM, HKDF-SHA-256 and SHA-256.

## [1.4.0] - 2026-08-21

### Added

- **`-f` / `--raw-field` takes a value verbatim as a string.** `-F externalTaskId=4821` typed the value as a number, which the Server refuses for a string field, and quoting it sent the quote marks as part of the value. `-f` sends exactly what you type. `-F` and `-f` can be mixed, so `-F a.b=1 -f a.c=2` builds one object.
- **`--idempotency-key` on `agledger api`, and a generated key on every POST.** A write retried after a timeout or a dropped connection no longer creates a second record. Pass `--idempotency-key` to reuse the first attempt's key when retrying a call that may already have reached the Server: the Server returns the original result. The key binds to method, route and body, so a retry that changes the body is rejected. `--dry-run` names the key it would send.

### Fixed

- **Object query parameters reached the wire as `[object Object]`,** so `agledger api GET /v1/records/search` with a `criteria` or `metadata` filter returned 400. Objects now expand into bracket notation (`metadata[state]=blocked`), and a `Date` serializes as ISO-8601.

### Changed

- `@agledger/verify-core` moves to `^1.4.0`.

## [1.3.1] - 2026-08-07

### Fixed

- **`--dry-run` no longer reports a server the real call refuses to use.** With no URL configured, `agledger api GET /v1/records --dry-run` reported a placeholder `apiUrl` and exited 0, while the same call without `--dry-run` exited 2 with `CONFIG_ERROR`. It now reports `apiUrl: null` plus an `apiUrlSource` line naming the error the real call raises.
- **The documentation no longer promises a default API URL.** The README and `SKILL.md` said the API-URL chain ended in a default. There is none: a call with nothing configured exits 2.

### Changed

- `Dry run:` replaces the dash form in the non-JSON header line. `--json` output is unaffected.

### Packaging

- Source maps are no longer published; they pointed at sources not in the tarball.

## [1.3.0] - 2026-08-07

### Changed

- **Public discovery paths no longer require a key.** `docs`, `discover`, and `agledger api GET` against `/health`, `/llms.txt`, `/llms-full.txt`, `/openapi.json`, `/docs`, `/v1/conformance` and `/.well-known/*` send the request with no Authorization header instead of failing with `AUTH_REQUIRED`. Only GET qualifies.
- **No placeholder API URL.** A missing URL now fails immediately with `CONFIG_ERROR` (exit 2) and says what to pass, instead of failing with a DNS error against a placeholder host.
- **`NETWORK_ERROR` names the URL it tried and the underlying cause,** with a suggestion tailored to `ENOTFOUND` and `ECONNREFUSED`.
- **`CHAIN_KEY_NOT_YET_ACTIVE`** is reported by `agledger verify` for an entry written before its signing key's activation, via `@agledger/verify-core` 1.3.0; `CHAIN_KEY_EXPIRED` now means the retirement side only.

### Fixed

- **README Quick Start and two `api --help` examples returned 400.** They built criteria as `task_description`; the seeded contracts require `summary`. Both are fixed and verified against a live instance.
- **`verify` no longer suggests `--input` and `--data`** in its read and parse failures; it has neither flag.
- **An unknown command gives a nearest match and a way forward:** a did-you-mean, a pointer to `list-commands`, and a note that `agledger api` reaches every route.

### Documentation

- Exit code 1 is documented as the catch-all: an API error whose status maps to nothing more specific (a 400) exits 1, as does a chain that fails `verify`. Read the `code` field to tell them apart.

## [1.2.0] - 2026-08-05

Signing-algorithm agility.

### Added

- **`verify` handles ES256 chains** via `@agledger/verify-core` 1.2.0. Unsupported algorithms still fail closed as `CHAIN_UNSUPPORTED_ALGORITHM`.

## [1.1.0] - 2026-08-05

### Changed

- **`agledger verify` takes `@agledger/verify-core` `^1.1.0`.** Algorithm dispatch binds to the trusted verification key rather than the unverified header. Tampered or missing header `alg` values fail as `CHAIN_ALG_MISMATCH`, a key algorithm beyond the build fails closed as `CHAIN_UNSUPPORTED_ALGORITHM`, the signed key id is cross-checked against `signingKeyId` (`CHAIN_SIGNING_KEY_DRIFT`), and untagged COSE_Sign1 is rejected. Legitimate Ed25519 exports verify identically.

## [1.0.6] - 2026-07-20

### Fixed

- `help-json <command>` now surfaces a flag's short alias as `char`, so `-F` on `agledger api --field` appears in the discovery schema.

## [1.0.5] - 2026-07-16

Docs only. No command, output, or behavior change.

### Changed

- README corrections: removed the drift-prone route-count claim and stale naming history, and the quickstart string now leads with notarize.

## [1.0.4] - 2026-06-29

### Changed

- Maintenance release. No user-visible change.

## [1.0.3] - 2026-06-22

### Fixed

- **`agledger auth` reported not-authenticated right after a successful `login`.** It looked only at `--api-key` and `AGLEDGER_API_KEY`, ignoring the stored profile in `~/.agledger/config.json`. It now resolves the key with the same precedence as every other command (flag, then env, then active stored profile) and reports the `source` (and `profile`, when applicable).

## [1.0.2] - 2026-06-20

### Changed

- Bumped `@agledger/verify-core` to `^1.0.0`. No CLI behavior change.

## [1.0.1] - 2026-06-10

### Changed

- Updated the `LICENSE` text to the current AGLedger SDK license template. No code changes.

## [1.0.0] - 2026-06-08

General-availability release, tracking AGLedger API v1.0.0. The CLI is a thin pass-through over the API.

### Fixed

- Fixes carried in from the unreleased 0.8.10 build ship for the first time in this release.

Releases before 1.0.0 are listed on npm (https://www.npmjs.com/package/@agledger/cli?activeTab=versions).
