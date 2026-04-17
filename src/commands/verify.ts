import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { verifyExport, type VerifyExportResult, type MandateAuditExport } from '../verify/verify-export.js';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';

/**
 * Offline verification of a mandate audit export. Runs entirely offline — no
 * network calls, no API key required. Keeps the CLI free of any @agledger/sdk
 * dependency by duplicating the verifier from the TS SDK; parity with the SDK
 * and Python port is enforced via shared test vectors under testdata/verifier/.
 */
export default class Verify extends BaseCommand {
  static override description =
    'Verify a mandate audit export offline (hash chain + Ed25519 signatures, RFC 8785).';

  static override examples = [
    '<%= config.bin %> verify audit-export.json',
    '<%= config.bin %> verify audit-export.json --keys vault-keys.json',
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
        'Path to a JSON file mapping signingKeyId → SPKI DER base64 public key. ' +
        'Merged over any keys embedded in the export.',
    }),
    'require-key-id': Flags.string({
      description:
        'Require every entry to reference this keyId. Rejects otherwise-valid exports ' +
        'signed by a retired or unexpected key.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Verify);

    const exportData = this.readJsonSource(args.file, 'audit export') as MandateAuditExport;
    if (!exportData || typeof exportData !== 'object' || !('entries' in exportData)) {
      this.failWith(
        ErrorCode.INVALID_JSON_INPUT,
        'File is not a valid audit export (expected exportMetadata + entries).',
        ExitCode.USAGE_ERROR,
        'Use `agledger api GET /v1/mandates/{id}/audit-export` to obtain a valid export.',
      );
    }

    const publicKeys = flags.keys
      ? (this.readJsonSource(flags.keys, 'public keys') as Record<string, string>)
      : undefined;

    const result = verifyExport(exportData, {
      publicKeys,
      requireKeyId: flags['require-key-id'],
    });

    if (this.isJson) {
      this.output(result);
    } else {
      this.renderHuman(result);
    }

    if (!result.valid) this.exit(ExitCode.GENERAL_ERROR);
  }

  private renderHuman(result: VerifyExportResult): void {
    if (this.isQuiet) return;

    const out = process.stdout;
    const icon = result.valid ? 'PASS' : 'FAIL';
    out.write(`${icon}  Mandate: ${result.mandateId}\n`);
    out.write(
      `       Entries: ${result.verifiedEntries}/${result.totalEntries} verified\n`,
    );

    if (result.valid) {
      out.write('       Hash chain contiguous, every signature verified.\n');
      return;
    }

    if (result.brokenAt) {
      out.write(`       Broken at position ${result.brokenAt.position}: ${result.brokenAt.reason}\n`);
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
