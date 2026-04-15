import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateOutcome extends BaseCommand {
  static override description = 'Report principal verdict on a receipt (PASS or FAIL with settlement signal)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    'receipt-id': Flags.string({ description: 'Receipt ID to judge', required: true }),
    outcome: Flags.string({ description: 'PASS or FAIL', required: true, options: ['PASS', 'FAIL'] }),
    reason: Flags.string({ description: 'Reason for the verdict' }),
    signal: Flags.string({ description: 'Settlement signal (settle, hold, escalate)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateOutcome);
    try {
      const body: Record<string, unknown> = {
        receiptId: flags['receipt-id'],
        outcome: flags.outcome,
      };
      if (flags.reason) body.reason = flags.reason;
      if (flags.signal) body.settlementSignal = flags.signal;

      const result = await this.api(flags, 'POST', `/mandates/${args.id}/outcome`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
