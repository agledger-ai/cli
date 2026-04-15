import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateCancel extends BaseCommand {
  static override description = 'Cancel a mandate';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Cancellation reason' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateCancel);
    try {
      const body: Record<string, unknown> = {};
      if (flags.reason) body.reason = flags.reason;
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/cancel`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
