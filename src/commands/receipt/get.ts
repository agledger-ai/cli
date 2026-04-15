import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class ReceiptGet extends BaseCommand {
  static override description = 'Get receipt details';
  static override args = {
    mandateId: Args.string({ description: 'Mandate ID', required: true }),
    receiptId: Args.string({ description: 'Receipt ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ReceiptGet);
    try {
      const result = await this.api(flags, 'GET', `/mandates/${args.mandateId}/receipts/${args.receiptId}`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
