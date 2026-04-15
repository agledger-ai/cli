import { readFileSync } from 'node:fs';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';
import { formatValidation } from '../../util/validation-formatter.js';

export default class SchemaValidate extends BaseCommand {
  static override description = 'Validate receipt evidence against a contract type schema';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
    file: Args.string({ description: 'Path to receipt evidence JSON file', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaValidate);
    try {
      const evidence = JSON.parse(readFileSync(args.file, 'utf-8'));
      const result = await this.api(flags, 'POST', `/schemas/${args.type}/validate`, { body: { evidence } });

      if (this.isJson) {
        this.output(result);
      } else {
        process.stdout.write(formatValidation(result as unknown as Parameters<typeof formatValidation>[0]));
      }
    } catch (err) {
      this.handleError(err);
    }
  }
}
