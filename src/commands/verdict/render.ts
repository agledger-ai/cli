import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class VerdictRender extends BaseCommand {
  static override description = 'Render a verdict on a notarized agreement (accept or reject delivery)';
  static override args = {
    mandateId: Args.string({ description: 'Mandate ID', required: true }),
    verdict: Args.string({ description: 'PASS to accept, FAIL to reject', required: true, options: ['PASS', 'FAIL'] }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Reason for the verdict' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(VerdictRender);
    try {
      const body: Record<string, unknown> = { verdict: args.verdict };
      if (flags.reason) body.reason = flags.reason;
      const result = await this.api(flags, 'POST', `/notarize/mandates/${args.mandateId}/verdict`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
