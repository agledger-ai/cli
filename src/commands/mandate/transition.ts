import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateTransition extends BaseCommand {
  static override description = 'Transition mandate state (register, activate, cancel)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
    action: Args.string({ description: 'Transition action', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Transition reason' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateTransition);
    try {
      const body: Record<string, unknown> = { action: args.action };
      if (flags.reason) body.reason = flags.reason;
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/transition`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
