import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class ReceiptList extends BaseCommand {
  static override description = 'List receipts for a mandate';
  static override args = {
    mandateId: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    all: Flags.boolean({ description: 'Stream all pages as NDJSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ReceiptList);
    try {
      await this.paginate(flags, `/mandates/${args.mandateId}/receipts`, {}, {
        all: flags.all,
        columns: ['id', 'status', 'verificationOutcome', 'createdAt'],
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
