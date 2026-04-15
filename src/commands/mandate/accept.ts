import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateAccept extends BaseCommand {
  static override description = 'Accept a proposed mandate (as performer)';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateAccept);
    try {
      const result = await this.api(flags, 'POST', `/mandates/${args.id}/accept`, { body: {} });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
