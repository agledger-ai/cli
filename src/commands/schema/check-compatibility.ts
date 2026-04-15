import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaCheckCompatibility extends BaseCommand {
  static override description = 'Check backward/forward compatibility of schema changes';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    'mandate-schema': Flags.string({ description: 'Path to mandate schema JSON file', required: true }),
    'receipt-schema': Flags.string({ description: 'Path to receipt schema JSON file', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaCheckCompatibility);
    try {
      const mandateSchema = JSON.parse(readFileSync(flags['mandate-schema'], 'utf-8'));
      const receiptSchema = JSON.parse(readFileSync(flags['receipt-schema'], 'utf-8'));
      const result = await this.api(flags, 'POST', `/schemas/${args.type}/check-compatibility`, {
        body: { mandateSchema, receiptSchema },
      });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
