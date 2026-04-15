import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaVersions extends BaseCommand {
  static override description = 'List all versions of a contract type schema';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaVersions);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}/versions`);
      this.outputPage(result as { data: unknown[] }, ['version', 'status', 'compatibilityMode', 'createdAt']);
    } catch (err) {
      this.handleError(err);
    }
  }
}
