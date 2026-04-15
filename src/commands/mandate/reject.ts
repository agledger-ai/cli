import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateReject extends BaseCommand {
  static override description = 'Reject a proposed mandate (as performer)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Rejection reason' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateReject);
    try {
      const body: Record<string, unknown> = {};
      if (flags.reason) body.reason = flags.reason;
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/reject`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
