import { writeFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaTemplate extends BaseCommand {
  static override description = 'Get a starter template from an existing contract type';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({ char: 'o', description: 'Write template to file' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaTemplate);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}/template`);

      if (flags.output) {
        writeFileSync(flags.output, JSON.stringify(result, null, 2) + '\n', 'utf-8');
        if (!this.isJson) {
          process.stderr.write(`Template written to ${flags.output}\n`);
        } else {
          this.output({ written: true, file: flags.output });
        }
      } else {
        this.output(result);
      }
    } catch (err) {
      this.handleError(err);
    }
  }
}
