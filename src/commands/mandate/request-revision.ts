import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateRequestRevision extends BaseCommand {
  static override description = 'Request revision after principal rejection (rework loop)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Reason for requesting revision' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateRequestRevision);
    try {
      const body: Record<string, unknown> = {};
      if (flags.reason) body.reason = flags.reason;
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/revision`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
