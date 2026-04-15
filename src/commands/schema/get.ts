import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaGet extends BaseCommand {
  static override description = 'Get the full JSON Schema for a contract type';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaGet);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
