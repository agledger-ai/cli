import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaRules extends BaseCommand {
  static override description = 'Get verification rules for a contract type';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaRules);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}/rules`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
