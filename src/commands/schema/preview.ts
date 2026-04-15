import { readFileSync } from 'node:fs';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';
import { formatValidation } from '../../util/validation-formatter.js';

export default class SchemaPreview extends BaseCommand {
  static override description = 'Preview a schema before registration';
  static override args = {
    file: Args.string({ description: 'Path to schema definition JSON file', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaPreview);
    try {
      const data = JSON.parse(readFileSync(args.file, 'utf-8'));
      const result = await this.api(flags, 'POST', '/schemas/preview', { body: data });

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
