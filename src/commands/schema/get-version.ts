import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaGetVersion extends BaseCommand {
  static override description = 'Get a specific version of a contract type schema';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    version: Flags.integer({ description: 'Version number', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaGetVersion);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}/versions/${flags.version}`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
