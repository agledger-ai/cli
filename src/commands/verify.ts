import { Args, Flags } from '@oclif/core';
import {
  verifyAuditExport,
  type AgentPublicKeyJwk,
  type OutOfBandKeyEntry,
  type VerifyExportResult,
  type RecordAuditExportInput,
} from '@agledger/verify-core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';

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
    '<%= config.bin %> verify audit-export.json',
    '<%= config.bin %> verify audit-export.json --keys vault-keys.json',
    '<%= config.bin %> verify audit-export.json --agent-keys agent-jwks.json',
    '<%= config.bin %> verify audit-export.json --json',
    'cat audit-export.json | <%= config.bin %> verify -',
  ];

  static override args = {
    file: Args.string({
      description: 'Path to the audit export JSON file (or "-" for stdin).',
      required: true,
    }),
  };

  static override flags = {
    json: BaseCommand.baseFlags.json,
    quiet: BaseCommand.baseFlags.quiet,
    keys: Flags.string({
      description:
        'Path to a JSON file holding out-of-band public keys. Accepts a ' +
        '{keyId: SPKI-DER-base64} map, a [{keyId, publicKey, ...}] list, or the ' +
        'raw GET /v1/verification-keys response envelope ({data:[...], ...}, the ' +
        '.data array is unwrapped automatically). Merged over any keys embedded ' +
        'in the export.',
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
    'require-out-of-band-keys': Flags.boolean({
      description:
        'High-assurance: refuse keys embedded in the export. Verifying the engine against ' +
        'its own embedded key is not an independent audit, so supply keys via --keys instead.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Verify);

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

    const agentKeys = flags['agent-keys']
      ? this.unwrapAgentKeys(
          this.readJsonSource(
            flags['agent-keys'],
            'agent keys',
            'The --agent-keys file must be an Ed25519 JWK, a list of them, or a {keys:[...]} JWK Set.',
          ),
        )
      : undefined;

    // verify-core throws TypeError at the OOB-key boundary when the file's
    // shape is wrong (e.g. {keyId: 42}, [null], "..."). Catch it so the CLI
    // emits its structured-error envelope rather than oclif's raw exception
    // trace; agents parsing stderr need {code, message, suggestion}, not a
    // stack frame. See verify-core/audit-export.ts normalizeOutOfBandKeys.
    let result: VerifyExportResult;
    try {
      result = verifyAuditExport(exportData, {
        publicKeys,
        requireKeyId: flags['require-key-id'],
        requireOutOfBandKeys: flags['require-out-of-band-keys'],
        agentKeys,
      });
    } catch (err) {
      if (err instanceof TypeError) {
        this.failWith(
          ErrorCode.INVALID_JSON_INPUT,
          err.message,
          ExitCode.USAGE_ERROR,
          'The --keys file must be a {keyId: SPKI-DER-base64} map or a list of ' +
            '{keyId, publicKey, ...} entries (the .data list from /v1/verification-keys); ' +
            'the --agent-keys file must hold Ed25519 JWKs ({"kty":"OKP","crv":"Ed25519","x":"..."}).',
        );
      }
      throw err;
    }

    if (this.isJson) {
      this.output(result);
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
  private unwrapKeys(raw: unknown): Record<string, string> | ReadonlyArray<OutOfBandKeyEntry> {
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Array.isArray((raw as { data?: unknown }).data)
    ) {
      return (raw as { data: ReadonlyArray<OutOfBandKeyEntry> }).data;
    }
    return raw as Record<string, string> | ReadonlyArray<OutOfBandKeyEntry>;
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
    const icon = result.valid ? 'PASS' : 'FAIL';
    out.write(`${icon}  Record: ${result.recordId}\n`);
    out.write(
      `       Entries: ${result.verifiedEntries}/${result.totalEntries} verified\n`,
    );

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

    if (result.valid) {
      out.write('       Hash chain contiguous, every Server signature verified.\n');
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
