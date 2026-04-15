import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateChain extends BaseCommand {
  static override description = 'Get full delegation chain for a mandate';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateChain);
    try {
      const result = await this.api(flags, 'GET', `/mandates/${args.id}/chain`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
