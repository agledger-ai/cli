import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaRegister extends BaseCommand {
  static override description = 'Register a new custom contract type schema';
  static override args = {
    file: Args.string({ description: 'Path to schema definition JSON file', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    'dry-run': Flags.boolean({ description: 'Show what would be sent without hitting the API', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaRegister);
    try {
      const data = JSON.parse(readFileSync(args.file, 'utf-8'));

      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would register:\n');
        this.output(data);
        return;
      }

      const result = await this.api(flags, 'POST', '/schemas', { body: data });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
