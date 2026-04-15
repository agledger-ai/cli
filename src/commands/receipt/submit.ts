import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class ReceiptSubmit extends BaseCommand {
  static override description = 'Submit a receipt (evidence of completion) for a mandate';
  static override args = {
    mandateId: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    data: Flags.string({ description: 'Evidence as JSON string' }),
    file: Flags.file({ description: 'Read evidence from JSON file' }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without hitting the API', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ReceiptSubmit);
    try {
      let raw: Record<string, unknown> = {};
      if (flags.file) {
        raw = JSON.parse(readFileSync(flags.file, 'utf-8'));
      } else if (flags.data) {
        raw = JSON.parse(flags.data);
      }

      // If the user already provided { evidence }, pass through.
      // Otherwise, wrap --data as evidence.
      let body: Record<string, unknown>;
      if ('evidence' in raw) {
        body = raw;
      } else {
        body = { evidence: raw };
      }
      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output(body);
        return;
      }

      const result = await this.api(flags, 'POST', `/mandates/${args.mandateId}/receipts`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
