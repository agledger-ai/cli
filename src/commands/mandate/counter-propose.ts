import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateCounterPropose extends BaseCommand {
  static override description = 'Counter-propose a mandate with revised terms (as performer)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    data: Flags.string({ description: 'Counter-proposal data as JSON string (counterCriteria, message)', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateCounterPropose);
    try {
      const body = JSON.parse(flags.data);
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/counter-propose`, { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
