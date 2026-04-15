import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaImport extends BaseCommand {
  static override description = 'Import a schema bundle from a file';
  static override args = {
    file: Args.string({ description: 'Path to schema export JSON file', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    'dry-run': Flags.boolean({ description: 'Preview what would be imported without persisting', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaImport);
    try {
      const payload = JSON.parse(readFileSync(args.file, 'utf-8'));

      if (flags['dry-run']) {
        // API supports dry-run via query param
        const result = await this.api(flags, 'POST', '/schemas/import', {
          body: payload,
          query: { dryRun: true },
        });
        this.output(result);
        return;
      }

      const result = await this.api(flags, 'POST', '/schemas/import', { body: payload });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
