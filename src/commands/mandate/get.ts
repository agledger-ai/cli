import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateGet extends BaseCommand {
  static override description = 'Get mandate details by ID';
  static override args = {
    id: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MandateGet);
    try {
      const result = await this.api(flags, 'GET', `/mandates/${args.id}`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
