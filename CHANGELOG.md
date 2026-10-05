# Changelog

All notable changes to the AGLedger CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-09-30

Targets API 2.0 only. The major version follows the API's.

### Breaking

- **`--require-out-of-band-keys` is `--require-supplied-keys`.** A key fetched from the Server's `/v1/verification-keys` comes from the same database as the export, so "out of band" promised an independence the flag never gave. Behaviour is unchanged. In `--json` output, `keyProvenance.outOfBand` is `keyProvenance.supplied`, `optionalChecks` carries `key_anchoring`, and every result carries `keyTrust`.
- **A chain that verifies without `--trust-anchor` prints `VERIFIED, NOT ANCHORED`, not `PASS`.** It still exits 0, and its JSON carries `verdict: "unanchored"` and `keyTrust.status: "no_anchor"` (a trusted pass is `verdict: "trusted"`, a failure `"failed"`), the headline words and verdicts of `@agledger/verify` and the Python `agledger-verify`. A run with `--trust-anchor` that verified no signature under an anchored key, as for an export of unsigned history, is `VERIFIED, NOT ANCHORED` as well (`keyTrust.status: "no_anchored_signature"`, `verdict: "unanchored"`). For both, the human report says nothing failed but this is NOT a trusted verdict, in the words `@agledger/verify` prints, and without an anchor it names the key the export claims as its Server's (`exportMetadata.anchoredFrom`, which is not an anchor), and says how to pin one. `PASS` is printed only when every key is linked to your anchor and a signature verified under one.

### Added

- **`agledger verify --trust-anchor sha256:<digest>`** (repeatable) anchors the vault keys to one you took out of band, through `@agledger/verify-core` 2.0.0: the signed key statements the export carries, plus the `statements` on keys passed with `--keys`, are walked from it. An entry signed by a key the walk does not reach fails `CHAIN_SIGNING_KEY_UNANCHORED`; a key statement that does not hold is reported as `KEY_STATEMENT_INVALID`, `KEY_CLOSURE_INVALID` or `CHAIN_KEY_WINDOW_DRIFT` under `keyTrust.findings`, which is `brokenAt` at position 0 when the chain itself is intact (when the chain also breaks, `brokenAt` is the chain failure), and the human report prints each finding. The report names how many keys were anchored and which were not.
- **`--distrusted-key sha256:<digest>[@<RFC 3339 instant>]`** (repeatable) mirrors the operator's `VAULT_DISTRUSTED_KEYS`: what such a key signed from the instant counts for nothing in the walk. Without `--trust-anchor` it is refused (`MISSING_INPUT`, exit 2) rather than ignored, and a malformed anchor or distrusted key, one named twice, or a key given to `--trust-anchor` and to `--distrusted-key` with no instant (the Server refuses to start with that pair), is `INVALID_FIELD`, exit 2. A dated `--distrusted-key` beside a `--trust-anchor` for the same key is taken: the pin vouches for what the key signed before the instant. A `--keys` or `--agent-keys` file verify-core refuses, a key window that is not RFC 3339 included, is `INVALID_FIELD` (was `INVALID_JSON_INPUT`): the file parsed, a value in it did not hold. A file that does not exist is `FILE_READ_ERROR`, exit 2. `--trust-anchor` and `--distrusted-key` take one value each time, so the export path may come before or after them (`agledger verify --trust-anchor sha256:<digest> export.json` works), and a missing path is `MISSING_INPUT`, exit 2. All of these are checked before the export is read, with the messages `@agledger/verify` and the Python `agledger-verify` print, and `--distrusted-keys` and `--require-out-of-band-keys` are refused naming the flag that replaced them.

- **`agledger verify` reports an unsigned entry written while the vault was signing.** An entry with no signing key fails with the new `CHAIN_ENTRY_UNSIGNED` when an earlier entry in its chain names a key, or when it was written at or after the earliest activation time among the keys the verifier holds. An unsigned history written before the first key stays reduced coverage, as before. An entry that names a key but carries an all-zero signature now fails `CHAIN_SIGNATURE_INVALID`. Both match the Server's own chain verification. An entry with no readable `createdAt` where the check needs one, or a null payload or key, now fails with a failure code such as `CHAIN_MALFORMED_ENTRY` rather than passing or throwing.
- **`agledger verify` names the entries that carry no signature.** A pass over a chain with unsigned entries prints `Unsigned: N of M entries carry no signature (written before the install registered its first key), so they are covered by the hash chain only.`, rather than letting the pass speak for them.

### Changed

- **`agledger logout` with no flags removes the active profile.** It used to act on the profile named `default`, so after `agledger config use prod` it removed nothing, exited 0 and left `prod` in use. `--profile <name>` still names one explicitly. Removing nothing is now an error: a missing profile, or no active profile, exits 2 with `MISSING_INPUT` (was exit 0 with `loggedOut: false`).
- **`--profile` naming no stored profile exits 3 whatever else is set.** With `AGLEDGER_API_KEY` or `--api-key` and a URL supplied, the call used to run as that key and ignore the mistyped profile; it now exits 3 `AUTH_REQUIRED` "Profile ... not found", `--dry-run` included, as the README says.
- **`agledger logout` leaves no profile active after removing the active one.** It used to make the first remaining profile active, so an admin profile stored beside an agent one took over the next call. The output carries `activeProfile: null` and a `note` naming the profiles left and `config use`. `logout --all` with nothing stored exits 2 `MISSING_INPUT`, as a plain logout does (was exit 0 with an empty `removedProfiles`).
- **A POST that times out or loses its connection names the key it sent.** The `TIMEOUT` error, and a `NETWORK_ERROR` after the request went out (not one refused or unresolved), carry `idempotencyKey`, and the suggestion is to rerun with `--idempotency-key <key>` so the Server replays the first attempt instead of creating a second record. It used to say "Retry the same command", and the rerun minted a fresh key. `--verbose` reports the key every POST goes out under. The wait is `AGLEDGER_TIMEOUT` (seconds, default 30, as for `agledger-mcp`), which the `TIMEOUT` suggestion names for a slow instance; a value that is not a positive number up to 2147483 exits 2 `CONFIG_ERROR`. A GET has no key and claims none.
- **A malformed API URL is a configuration error.** A URL from `--api-url`, `AGLEDGER_API_URL` or a stored profile that is not an absolute `http` or `https` URL exits 2 with `CONFIG_ERROR`, naming where it came from (was exit 1 `UNKNOWN_ERROR` "Invalid URL" at request time), and `login --oidc` refuses one before running the token source. `--dry-run` says the real call would fail with `CONFIG_ERROR`.
- **The API URL is checked before the credential.** A call with neither a URL nor a credential exits 2 with `CONFIG_ERROR` (was exit 3 `AUTH_REQUIRED`), as the README describes: without a URL there is no Server to authenticate to. A `--profile` naming no stored profile is still reported first (exit 3, profile not found).
- `agledger verify` walks an export's key statements in write order (`createdAt`, then `id`), which every API 2.0 export carries, so the key-anchoring findings name the statement row, and a trusted key's later admissions date its window as the Server's do. The write times decide only the order: they are not signed, so a key statement signed by a key in `distrustedKeys` counts for nothing whatever time it carries. A statement that counts for nothing only because its signer is distrusted, dated before the cutoff by the export's own unsigned write time, is a `keyTrust.notes` entry rather than a finding, so an honest rotation away from a key distrusted after it still passes pinned on its successor. The human output lists each note as `Key note:`.
- **Error bodies are read through `detail`.** API 2.0 removed the top-level `message` from every RFC 9457 error body; `detail` is the one human-readable field. `classify401` (which credential a 401 is about) and the OIDC exchange error now read `detail` only, where they used to fall back to `message` (cli#27). API errors still pass through to stderr verbatim. The CLI's own errors (`{error, code, message, suggestion}`) keep their `message`, since those are not API bodies.
- **`AGLEDGER_OIDC_AGENT_ID` and `login --oidc-agent-id` are documented as an assertion, not a choice of agent.** The Server binds a cert to the agent the token names (a mapped `agent_id` claim, else the agent carrying the token's `oidcIss`/`oidcSub`, else an auto-provisioned one), and never to one the request body chooses. When the id names a different agent, or the token binds none, the exchange is refused with 403 `CERT_AGENT_BINDING_MISMATCH`; a token bound to a federation shadow agent is refused with 403 `SHADOW_AGENT_CERT_FORBIDDEN`. The flag's help, the README and `SKILL.md` now say so, and point at binding the agent instead: `PATCH /v1/agents/{id}` with `oidcIss` and `oidcSub`, or `claimMapping.agent_id` on the trusted issuer. The CLI still sends the id when it is set, and the refusal still fails with `OIDC_EXCHANGE_FAILED` (exit 4 on a 403) carrying the Server's error body and its `recoveryHint` under `apiError`.
- **Conformance corpus regenerated** from the 2.0 engine (`apiGitSha e690979c`, `apiVersion 2.0.0`): 35 export vectors, every earlier vector with the same expected outcome and failure code, and three new ones covering unsigned entries (two expect `CHAIN_ENTRY_UNSIGNED`, one a clean pass). The suite replays every vector a second time with `--trust-anchor` set to the key the export names, where only the key-substitution vector changes outcome (to `CHAIN_SIGNING_KEY_UNANCHORED`), and an all-unsigned export passes with `verdict: "unanchored"`.

## [1.5.0] - 2026-09-21

### Added

- **Conformance corpus regenerated from the tagged 1.8.0 engine** (`apiGitSha 3948cc68`, the `v1.8.0` commit), replacing a corpus generated at API 1.3.4. The export slice goes from 23 to 32 vectors and the dump slice from 12 to 18, and the additions cover this release's own work: `export/actor-attribution-mismatch.json` and `dump/chain-actor-attribution-mismatch` both expect `CHAIN_ACTOR_ATTRIBUTION_MISMATCH`, and `export/agent-signature-invalid.json` expects `CHAIN_AGENT_SIGNATURE_INVALID`. The runner now maps the manifest's `agentKeysFile` to the verifier's agent-key input; without it that vector ran with no agent keys, reported `skipped_no_input`, passed, and failed the suite on a check that never executed.

- **`agledger verify` refuses a re-attributed export.** The `actorId`, `actorRole` and `actorOwnerId` an export displays are signature-covered, and they are now cross-checked against the signed actor claim, so an export re-attributed to another actor fails with the new `CHAIN_ACTOR_ATTRIBUTION_MISMATCH` instead of verifying. Requires `@agledger/verify-core` 1.5.0.
- **`agledger verify --agent-keys <file>` re-verifies sealed agent signatures offline.** The file holds the Ed25519 public keys of agent certs (a JWK, a list of JWKs, a `{keys:[...]}` JWK Set, or entries wrapping one as `{publicKeyJwk}`). An entry whose sealed agent signature names one of them by thumbprint has that signature checked, and a mismatch fails the chain as `CHAIN_AGENT_SIGNATURE_INVALID`. The JSON result reports `agentSignatures {present, verified}`, and the human output prints the count. Requires `@agledger/verify-core` 1.5.0.
- **Delegation: `AGLEDGER_ON_BEHALF_OF_CMD` / `AGLEDGER_ON_BEHALF_OF_FILE`.** When set, the CLI sends the RFC 8693 delegation token they yield as `AGLedger-On-Behalf-Of` on every POST, beside its own credential, and the Server seals the delegation into the signed chain entry (`bound` under an OIDC cert whose subject is the token's `act`, `unbound` on an API key). The token is reused until shortly before its `exp`, never printed, and `--verbose` names only the variable in use.
- **OIDC token sources: an agent can authenticate with its own identity provider instead of an API key** (cli#22). Set `AGLEDGER_OIDC_TOKEN_CMD` to a shell command whose stdout is an OIDC JWT (`gcloud auth print-identity-token`, `az account get-access-token`, `vault`, `kubectl create token`, or any script), or `AGLEDGER_OIDC_TOKEN_FILE` to a file holding one, such as a projected service-account token that Kubernetes rotates on disk. `AGLEDGER_OIDC_AGENT_ID` optionally names the agent the cert binds to. The CLI exchanges the token at `POST /v1/auth/oidc/cert` for a short-lived cert the Server signs and sends that cert as the bearer. The source is called again for every exchange, because the Server accepts each token id only once. A token file therefore serves one run until it rotates; a second run against the same token fails with an error that says so and points at `AGLEDGER_OIDC_TOKEN_CMD`. Each invocation generates an Ed25519 key pair in memory and proves possession of it in the exchange; neither the key nor the cert is ever written to disk. The exchange is implemented in the CLI's own client, with no SDK dependency.
- **Signed writes under a cert.** Every request with a body carries `X-Agent-Signature-Content-Hash` and `X-Agent-Signature`, an Ed25519 signature over the SHA-256 of the exact bytes sent, so the chain entry records the agent's own signature under `on_behalf_of.agent_signature` beside the Server's.
- **Refresh and retry.** A cert is re-exchanged once half its lifetime has passed. A 401 to a cert bearer triggers one re-exchange and one retry of the same request (same body, same `Idempotency-Key`); a second 401 is reported as the Server sent it. Concurrent requests share one exchange.
- **`agledger login --oidc`** verifies a token source with one exchange and a `GET /v1/auth/me`, then stores the source in the profile: `--oidc-token-cmd` or `--oidc-token-file`, each also read from its environment variable, and optionally `--oidc-agent-id`. A token, cert or key is never stored. `config list` and `config get` report which kind of credential a profile holds.
- **`agledger auth` shows the cert identity** when a token source is in use: the cert the Server issued (id, agent, issuer, subject, scopes, issue and expiry times) beside the `GET /v1/auth/me` account.
- **`--verbose` on every command** reports which credential a command used and each OIDC exchange (cert id, agent, subject, expiry, and why it ran) as JSON lines on stderr. It never prints a key, token or cert.

### Changed

- `LICENSE` follows SDK License Template 1.9: section 1 says AGLedger LLC does not receive, inspect or use the data you process through your deployment and collects no product usage information from it; section 7 names AGLedger and Settlement Signal as trademarks of AGLedger LLC; section 8 refers to issued or pending U.S. patents.
- **Credential precedence** is now: `--api-key` or `AGLEDGER_API_KEY`, then `AGLEDGER_OIDC_TOKEN_CMD`, then `AGLEDGER_OIDC_TOKEN_FILE`, then the stored profile's API key or token source. An API key set explicitly always wins. The no-credential error (`AUTH_REQUIRED`, exit 3) now names all three sources.
- **`--dry-run`** names an OIDC token source (`credential: "oidc-cert"`, `oidcTokenSource`) without running it.
- **`discover` checks `/health` without a credential**, so a token source or identity provider that is down does not also hide whether the Server is up.
- **README:** the Quick Start uses an agent key. With the admin key it showed, the record create was refused (an admin key must name an agent principal) and the completion was refused (only the performer submits one). The completion step now creates the record it completes, with the seeded `principal-gate-generic-v1` and `autoActivate`, since a `notarize-generic-v1` record takes no completion. The `login` example passes `--api-url`, without which it exited 2, and the `-F`/`-f` example includes the fields a create requires. Every block was run against a 1.8.0 Server.

### Fixed

- **`--paginate` under an OIDC token source exchanged once per page.** Each page built a new client, so a new key pair and a new cert exchange: with `AGLEDGER_OIDC_TOKEN_FILE` the second page failed 409 (the Server exchanges a token id once), and with a command every page spent an exchange against the route's per-IP rate limit. One client now serves the whole invocation.
- **A 401 is renewed according to what it is about.** One naming the delegation token (`AGLedger-On-Behalf-Of`) re-reads the delegation source and retries once, with the same cert. One naming `X-Agent-Signature` is reported as it came, since the same key would sign the same bytes. Any other 401 on a cert bearer still triggers one re-exchange.
- **Cert refresh is timed from local receipt.** The lifetime is the Server's (`expiresAt` minus `issuedAt`), measured from when the cert arrived, so a local clock minutes ahead of the Server no longer re-exchanges on every request. A refresh that fails while the cert is still valid (an unrotated token file, the IdP down, 429, 5xx) keeps the current cert, backs off before trying again, and is reported under `--verbose`; it fails only once the cert has expired or when the Server refused the cert.
- **Delegation tokens:** one with no `exp` is read again for every request instead of being held for the whole run; one already expired is refused before sending, naming the variable; one with no `sub` is explained in delegation terms rather than cert-exchange terms.
- **A token command that times out is killed with its whole process group**, so a pipeline's children do not outlive it, and output past 64 KiB is refused as not one token.
- **`login --oidc --oidc-token-file` no longer spends the token.** It checks the file holds a JWT and saves the profile without exchanging it; exchanging there left the next command a token the Server had already exchanged until the file rotated. A token command is still verified with one exchange.

### Security

- **Tokens stay out of output.** A token command that fails exits 3 with `OIDC_TOKEN_SOURCE_FAILED`, naming the variable and carrying the command's stderr with anything shaped like a JWT redacted. Output that is not a JWT is reported by length, never echoed. A refused exchange exits with `OIDC_EXCHANGE_FAILED` and forwards the Server's error body (its `recoveryHint` included) with the token scrubbed out of it: the Server's validation errors echo the offending input, which on this route is the token.

## [1.4.1] - 2026-09-10

### Changed

- **oclif 5.** `@oclif/core` 4 to 5 and the `oclif` build tool 4 to 5. Command surface, flags, help text and the exit codes (2 usage, 3 no credentials, 9 unreachable Server) are unchanged; the suite and the failure paths were re-run on the new major before it was taken.

- **LICENSE section 6 names the ciphers this package line ships**: Ed25519 (EdDSA), ECDSA P-256 with SHA-256, HMAC-SHA-256, AES-256-GCM, HKDF-SHA-256 and SHA-256. X25519 is gone from the list with the federation encryption key the engine no longer has. The LICENSE file is the only shipped byte that moved.

## [1.4.0] - 2026-08-21

### Added

- **`-f` / `--raw-field`, which takes a value verbatim as a string.** The Server stopped coercing the fields of a JSON body, so a field declared `string` refuses a number. `publisher`, `platformRef`, `projectRef`, `externalTaskId` and `correlationId` are plain strings carrying identifiers minted by other systems, and those are frequently all digits, so `-F externalTaskId=4821` typed the value as a number and was refused. No `-F` form produced the four characters: quoting reached the Server as a string with the quote marks inside it, which the Server accepts, so the nearest workaround notarized a corrupted identifier into a signed, immutable Record and broke every cross-system join on it. `-f` is the one-character answer, and restores parity with `gh api`, which the flag syntax was modelled on and which has had both forms all along. Path syntax is identical; `-F` and `-f` parse together, so `-F a.b=1 -f a.c=2` builds one tree. Reported by agledger-testbed against the 1.4.0 candidate (agents#122).

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
