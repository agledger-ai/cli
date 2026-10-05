import { existsSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import {
  assertNotPinnedAndDistrusted,
  parseDistrustedKeys,
  parseTrustAnchors,
  verifyAuditExport,
  type AgentPublicKeyJwk,
  type SuppliedKeyEntry,
  type VerifyExportResult,
  type RecordAuditExportInput,
} from '@agledger/verify-core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';

/**
 * verify-core words a finding, note or failure for a library caller, so its
 * advice names options (`give distrustedKeys sha256:<hex>@<instant>`, `pin
 * sha256:<hex> in trustAnchors`). Here they are flags, so the report names the flag, in the
 * words `@agledger/verify` prints; verify-core's own result is left as it is.
 */
const OPTION_FLAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\badd (sha256:[0-9a-f]{64}) to distrustedKeys\b/g, 'add --distrusted-key $1'],
  [/\bis in distrustedKeys\b/g, 'is given as a --distrusted-key'],
  [/\bin trustAnchors\b/g, 'with --trust-anchor'],
  [/\bNo trustAnchors were given\b/g, 'No --trust-anchor was given'],
  [/\bdistrustedKeys\b/g, '--distrusted-key'],
  [/\btrustAnchors\b/g, '--trust-anchor'],
  [/\brequireSuppliedKeys\b/g, '--require-supplied-keys'],
  [/\brequireKeyId\b/g, '--require-key-id'],
  [/\bagentKeys\b/g, '--agent-keys'],
];

/** One string from a result, its option names given as this command's flags. */
export function flagWording(text: string): string {
  return OPTION_FLAGS.reduce((s, [pattern, flag]) => s.replace(pattern, flag), text);
}

/** A copy of a result with every string in it worded by {@link flagWording}. */
function withFlagWording<T>(value: T): T {
  if (typeof value === 'string') return flagWording(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => withFlagWording(v)) as T;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withFlagWording(v)])) as T;
  }
  return value;
}

/**
 * Offline verification of a record audit export (format 2.0, COSE_Sign1).
 * Runs entirely offline: no network calls, no API key required. The
 * verification core is `@agledger/verify-core` (one dep, no network), shared
 * with the SDK, MCP server, and `@agledger/verify`; parity with the independent
 * Python port is enforced via the shared conformance corpus.
 */
export default class Verify extends BaseCommand {
  static override description =
    'Verify a record audit export offline (COSE_Sign1 envelope, RFC 9052; Ed25519 or ES256).';

  static override examples = [
    '<%= config.bin %> verify audit-export.json --trust-anchor sha256:<64 hex>',
    '<%= config.bin %> verify audit-export.json',
    '<%= config.bin %> verify audit-export.json --keys vault-keys.json',
    '<%= config.bin %> verify audit-export.json --agent-keys agent-jwks.json',
    '<%= config.bin %> verify audit-export.json --json',
    'cat audit-export.json | <%= config.bin %> verify -',
  ];

  // FILE is required, but checked in run() rather than by oclif: oclif's own
  // missing-arg error tells the caller to put arguments before every
  // repeatable flag, which is not true of non-greedy ones, and lists hidden
  // flags with them.
  static override usage = 'verify FILE [--trust-anchor <value>...] [--distrusted-key <value>...] [--keys <value>] [--agent-keys <value>] [--require-key-id <value>] [--require-supplied-keys] [--json] [--quiet]';

  static override args = {
    file: Args.string({
      description: 'Path to the audit export JSON file (or "-" for stdin).',
    }),
  };

  static override flags = {
    json: BaseCommand.baseFlags.json,
    quiet: BaseCommand.baseFlags.quiet,
    keys: Flags.string({
      description:
        'Path to a JSON file holding public keys you supply. Accepts a ' +
        '{keyId: SPKI-DER-base64} map, a [{keyId, publicKey, ...}] list, or the ' +
        'raw GET /v1/verification-keys response envelope ({data:[...], ...}, the ' +
        '.data array is unwrapped automatically, and each key\'s signed statements ' +
        'are walked with --trust-anchor). Merged over any keys embedded in the export. ' +
        'Where a key came from is not whether it is trusted: that is --trust-anchor.',
    }),
    'trust-anchor': Flags.string({
      multiple: true,
      multipleNonGreedy: true,
      description:
        'sha256:<64 hex> SPKI digest of a vault key you took out of band (the installer prints the ' +
        'first vault key\'s; the Server\'s signing-key-digest.js derives one from any key you hold). ' +
        'The signed key statements the export carries are walked from it: an entry signed by a key ' +
        'the walk does not reach fails CHAIN_SIGNING_KEY_UNANCHORED, and a statement that does not ' +
        'hold fails KEY_STATEMENT_INVALID, KEY_CLOSURE_INVALID or CHAIN_KEY_WINDOW_DRIFT. Without ' +
        'one, a pass rests on keys nobody pinned. Repeatable.',
    }),
    'distrusted-key': Flags.string({
      multiple: true,
      multipleNonGreedy: true,
      description:
        'sha256:<64 hex>, optionally @<RFC 3339 instant>: a key the operator distrusts, as in the ' +
        'Server\'s VAULT_DISTRUSTED_KEYS. What it signed from that instant (with none, from its ' +
        'retirement) counts for nothing in the walk. Requires --trust-anchor. A dated entry may name a ' +
        'key also given to --trust-anchor, which then vouches for what it signed before the instant. Where an ' +
        'export lists a key retired at the instant the Server distrusts it from (distrustedFrom), earlier than ' +
        'its signed retirement, a run without the same entry fails on that window, and the finding names the ' +
        '--distrusted-key to confirm with the Server\'s operator. Repeatable.',
    }),
    'agent-keys': Flags.string({
      description:
        'Path to a JSON file holding Ed25519 public keys of agent certs: a JWK, a list of JWKs, ' +
        'or a {keys:[...]} JWK Set (an entry may wrap its key as {publicKeyJwk:{...}}). Each is the publicKeyJwk an agent sent at cert exchange ' +
        '(also the cnf.jwk claim in its certJws). An entry whose sealed agent signature names one ' +
        'of them by thumbprint has that signature re-verified offline, and fails ' +
        'CHAIN_AGENT_SIGNATURE_INVALID if it does not verify.',
    }),
    'require-key-id': Flags.string({
      description:
        'Require every entry to reference this keyId. Rejects otherwise-valid exports ' +
        'signed by a retired or unexpected key.',
    }),
    // Refused by name, as @agledger/verify and the Python agledger-verify
    // refuse them, rather than as an unknown flag.
    'distrusted-keys': Flags.string({ hidden: true }),
    'require-out-of-band-keys': Flags.boolean({ hidden: true, default: false }),
    'require-supplied-keys': Flags.boolean({
      description:
        'Refuse keys embedded in the export: an entry whose only key is export-embedded fails ' +
        'CHAIN_KEY_POLICY_VIOLATION, so every signature is checked against a key from --keys.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Verify);

    if (flags['distrusted-keys'] !== undefined) {
      this.failWith(
        ErrorCode.INVALID_FIELD,
        '--distrusted-keys is now --distrusted-key, given once per key: --distrusted-key sha256:<hex>[@<RFC 3339 instant>].',
        ExitCode.USAGE_ERROR,
      );
    }
    if (flags['require-out-of-band-keys']) {
      this.failWith(
        ErrorCode.INVALID_FIELD,
        '--require-out-of-band-keys is now --require-supplied-keys: a key fetched from the Server is supplied, not independent of it. Pin --trust-anchor for that.',
        ExitCode.USAGE_ERROR,
      );
    }

    // Checked in the order @agledger/verify and the Python agledger-verify
    // check them, with the same messages and exit code, and before the export
    // is read: a mistyped pin is a usage error, never a verdict.
    const trustAnchors = flags['trust-anchor'] ?? [];
    const distrustedKeys = flags['distrusted-key'] ?? [];
    try {
      parseTrustAnchors(trustAnchors);
      parseDistrustedKeys(distrustedKeys);
    } catch (err) {
      if (err instanceof TypeError) {
        this.failWith(
          ErrorCode.INVALID_FIELD,
          err.message
            .replace(/^trustAnchors entry /, '--trust-anchor ')
            .replace(/^distrustedKeys entry /, '--distrusted-key ')
            .replace(/^distrustedKeys names /, '--distrusted-key names '),
          ExitCode.USAGE_ERROR,
          'Pass --trust-anchor sha256:<64 hex> and --distrusted-key sha256:<64 hex>[@<RFC 3339 instant>], once per key.',
        );
      }
      throw err;
    }
    // verify-core reads distrusted keys only during the walk, so without an
    // anchor they would be dropped without a word.
    if (distrustedKeys.length > 0 && trustAnchors.length === 0) {
      this.failWith(
        ErrorCode.MISSING_INPUT,
        '--distrusted-key acts only inside the key-statement walk, which runs from --trust-anchor; pass the pin as well.',
        ExitCode.USAGE_ERROR,
        'Pass --trust-anchor sha256:<64 hex> with the digest of a vault key you took out of band.',
      );
    }
    // The Server refuses to start with a key in VAULT_TRUST_ANCHORS that
    // VAULT_DISTRUSTED_KEYS names with no instant, so that pair is a usage
    // error. A dated entry beside a pin is taken.
    try {
      assertNotPinnedAndDistrusted(trustAnchors, distrustedKeys);
    } catch (err) {
      if (err instanceof TypeError) {
        this.failWith(
          ErrorCode.INVALID_FIELD,
          err.message.replace(/^(sha256:[0-9a-f]{64}) is a trust anchor and a distrusted key with no instant,/, '$1 is a --trust-anchor and a --distrusted-key with no instant,'),
          ExitCode.USAGE_ERROR,
          'Keep the pin and give the leaked key its instant: --distrusted-key sha256:<64 hex>@<RFC 3339 instant>. Or, if you vouch for nothing it signed, drop its --trust-anchor.',
        );
      }
      throw err;
    }
    if (args.file === undefined) {
      this.failWith(
        ErrorCode.MISSING_INPUT,
        'Missing the audit export to verify.',
        ExitCode.USAGE_ERROR,
        'Pass the path to an audit-export JSON file, or `-` to read it from stdin, before or after the flags.',
      );
    }
    if (args.file !== '-' && !existsSync(args.file)) {
      this.failWith(
        ErrorCode.FILE_READ_ERROR,
        `Cannot read ${args.file}: no such file or directory.`,
        ExitCode.USAGE_ERROR,
        'Pass the path to an audit-export JSON file, or `-` to read it from stdin. ' +
          'Obtain one with `agledger api GET /v1/records/{id}/audit-export`.',
      );
    }

    const agentKeys = flags['agent-keys']
      ? this.unwrapAgentKeys(
          this.readJsonSource(
            flags['agent-keys'],
            'agent keys',
            'The --agent-keys file must be an Ed25519 JWK, a list of them, or a {keys:[...]} JWK Set.',
          ),
        )
      : undefined;

    const exportData = this.readJsonSource(
      args.file,
      'audit export',
      'Pass the path to an audit-export JSON file, or `-` to read it from stdin. ' +
        'Obtain one with `agledger api GET /v1/records/{id}/audit-export`.',
    ) as RecordAuditExportInput;
    if (!exportData || typeof exportData !== 'object' || !('entries' in exportData)) {
      this.failWith(
        ErrorCode.INVALID_JSON_INPUT,
        'File is not a valid audit export (expected exportMetadata + entries).',
        ExitCode.USAGE_ERROR,
        'Use `agledger api GET /v1/records/{id}/audit-export` to obtain a valid export.',
      );
    }

    const publicKeys = flags.keys
      ? this.unwrapKeys(
          this.readJsonSource(
            flags.keys,
            'public keys',
            'The --keys file must be a {keyId: SPKI-DER-base64} map or the .data list from ' +
              '`agledger api GET /v1/verification-keys`.',
          ),
        )
      : undefined;

    // verify-core throws TypeError at the supplied-key boundary when the
    // file's shape is wrong (e.g. {keyId: 42}, [null], "...") or a key window
    // in it is not RFC 3339: valid JSON, a value refused. Catch it so the
    // CLI emits its structured-error envelope rather than oclif's raw
    // exception trace; agents parsing stderr need {code, message, suggestion},
    // not a stack frame.
    let result: VerifyExportResult;
    try {
      result = verifyAuditExport(exportData, {
        publicKeys,
        requireKeyId: flags['require-key-id'],
        requireSuppliedKeys: flags['require-supplied-keys'],
        ...(trustAnchors.length > 0 ? { trustAnchors, distrustedKeys } : {}),
        agentKeys,
      });
    } catch (err) {
      if (err instanceof TypeError) {
        this.failWith(
          ErrorCode.INVALID_FIELD,
          err.message,
          ExitCode.USAGE_ERROR,
          'The --keys file must be a {keyId: SPKI-DER-base64} map or a list of ' +
            '{keyId, publicKey, activatedAt?, retiredAt?} entries with RFC 3339 windows (the /v1/verification-keys body works as is); ' +
            'the --agent-keys file must hold Ed25519 JWKs ({"kty":"OKP","crv":"Ed25519","x":"..."}).',
        );
      }
      throw err;
    }
    // Findings, notes and suggestions name the flags, in JSON and text alike.
    result = withFlagWording(result);

    if (this.isJson) {
      // verify-core's result, plus the verdict @agledger/verify reports:
      // `valid` alone is true on a run that anchored nothing.
      const { verdict, ...rest } = result;
      this.output({ verdict, ...rest });
    } else {
      this.renderHuman(result, agentKeys !== undefined);
    }

    if (!result.valid) this.exit(ExitCode.GENERAL_ERROR);
  }

  /**
   * Accept the raw `GET /v1/verification-keys` response shape. That endpoint
   * returns an envelope `{ data: [{ keyId, publicKey, ... }], canonicalization, ... }`,
   * not the bare array its consumers expect, so unwrap `.data` so a file saved
   * straight from the endpoint verifies without hand-editing. A bare
   * `[{keyId, publicKey}]` list or a `{keyId: base64}` map passes through
   * untouched; verify-core then validates the shape and throws on anything else.
   */
  private unwrapKeys(raw: unknown): Record<string, string> | ReadonlyArray<SuppliedKeyEntry> {
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Array.isArray((raw as { data?: unknown }).data)
    ) {
      return (raw as { data: ReadonlyArray<SuppliedKeyEntry> }).data;
    }
    return raw as Record<string, string> | ReadonlyArray<SuppliedKeyEntry>;
  }

  /**
   * A single JWK, a list of JWKs, or a `{keys: [...]}` JWK Set, as a list. An
   * entry that wraps its key as `{ publicKeyJwk: {...} }` (how an agent records
   * the key it sent at cert exchange) is unwrapped. verify-core validates each.
   */
  private unwrapAgentKeys(raw: unknown): AgentPublicKeyJwk[] {
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { keys?: unknown }).keys)
        ? (raw as { keys: unknown[] }).keys
        : [raw];
    return list.map((entry) =>
      entry && typeof entry === 'object' && 'publicKeyJwk' in entry
        ? (entry as { publicKeyJwk: AgentPublicKeyJwk }).publicKeyJwk
        : (entry as AgentPublicKeyJwk),
    );
  }

  private renderHuman(result: VerifyExportResult, agentKeysGiven: boolean): void {
    if (this.isQuiet) return;

    const out = process.stdout;
    const trust = result.keyTrust;
    // PASS only when the walk from a pinned anchor verified at least one
    // signature. A chain that verifies against keys nobody pinned, or whose
    // anchors verified no signature at all, is not a clean result whatever
    // `valid` says, so it gets its own verdict word.
    const verdict = result.verdict;
    const anchored = trust.status === 'walked';
    // The same headline words as @agledger/verify and the Python agledger-verify.
    const icon = verdict === 'failed' ? 'FAIL' : verdict === 'trusted' ? 'PASS' : 'VERIFIED, NOT ANCHORED';
    out.write(`${icon}  Record: ${result.recordId}\n`);
    out.write(
      `       Entries: ${result.verifiedEntries}/${result.totalEntries} verified\n`,
    );

    if (verdict === 'unanchored') {
      out.write(
        trust.status === 'no_anchored_signature'
          ? '       Nothing failed, but this is NOT a trusted verdict: the --trust-anchor was walked, but no ' +
              'signature here verified under a key it anchors. An entry written before the install began ' +
              'signing carries no signature, and proves nothing about who wrote it.\n'
          : '       Nothing failed, but this is NOT a trusted verdict: no --trust-anchor was given, so every ' +
              "signing key was taken on the word of the export itself, and a key written into the Server's " +
              'database alone would verify. Ask the operator for the SPKI digest of a vault key (the ' +
              'installer prints it; signing-key-digest.js derives it from any key) and re-run with ' +
              '--trust-anchor sha256:<hex>.\n',
      );
    }
    if (anchored) {
      out.write(
        `       Keys: ${trust.anchoredKeyIds.length} anchored to --trust-anchor ${trust.anchors.join(', ')}` +
          (trust.unanchoredKeyIds.length > 0 ? `; not anchored: ${trust.unanchoredKeyIds.join(', ')}` : '') +
          (trust.undecidedKeyIds.length > 0 ? `; undecided on this host: ${trust.undecidedKeyIds.join(', ')}` : '') +
          '.\n',
      );
    } else if (trust.status === 'no_anchored_signature') {
      out.write(
        `       Keys: walked from --trust-anchor ${trust.anchors.join(', ')}; no signature verified under an anchored key.\n`,
      );
    } else {
      out.write('       Keys: not anchored (no --trust-anchor given), checked against keys nobody pinned.\n');
      if (trust.anchoredFrom) {
        out.write(`       The export names its Server's key as ${trust.anchoredFrom}: its own claim, not an anchor.\n`);
      }
    }
    for (const f of trust.findings) {
      out.write(`       Key finding: ${f.code}${f.keyId ? ` (${f.keyId})` : ''}: ${f.detail}\n`);
    }
    for (const n of trust.notes) {
      out.write(`       Key note: ${n.keyId ? `(${n.keyId}) ` : ''}${n.detail}\n`);
    }

    // Agent signatures are checked only against keys the caller supplies, so
    // the lines below say exactly how many were, and the PASS line speaks for
    // the Server's signatures alone.
    const { present, verified } = result.agentSignatures;
    const unchecked = present - verified;
    if (present > 0 && unchecked === 0) {
      out.write(`       Agent signatures: ${verified}/${present} re-verified offline against --agent-keys.\n`);
    } else if (present > 0 && agentKeysGiven) {
      out.write(
        `       Agent signatures: ${verified}/${present} re-verified offline; ${unchecked} name a key that is not in --agent-keys and were not checked.\n`,
      );
    } else if (present > 0) {
      out.write(
        `       Agent signatures: ${present} sealed on the chain, not checked. Pass --agent-keys with the agents' public keys to re-verify them.\n`,
      );
    }

    const { skipped } = result.signatureCoverage;
    if (result.valid && skipped > 0) {
      out.write(
        `       Unsigned: ${skipped} of ${result.totalEntries} entries carry no signature (written before the install registered its first key), so they are covered by the hash chain only.\n`,
      );
    }

    if (result.valid) {
      out.write(
        verdict === 'trusted'
          ? '       Hash chain contiguous, every Server signature verified under a key linked to your trust anchor.\n'
          : trust.status === 'no_anchored_signature'
            ? '       Hash chain contiguous, but no Server signature verified under a key your trust anchor reaches.\n'
            : '       Hash chain contiguous and every Server signature verifies, against keys nobody pinned.\n',
      );
      return;
    }

    if (result.brokenAt) {
      out.write(`       Broken at position ${result.brokenAt.position}: ${result.brokenAt.code}\n`);
      if (result.brokenAt.detail) {
        out.write(`       Detail: ${result.brokenAt.detail}\n`);
      }
    }

    const failures = result.entries.filter((e) => !e.valid);
    if (failures.length > 1) {
      out.write(`       ${failures.length} entries failed verification.\n`);
    }
  }
}
