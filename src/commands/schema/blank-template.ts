import { writeFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaBlankTemplate extends BaseCommand {
  static override description = 'Get a blank template for creating a custom contract type from scratch';
  static override flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({ char: 'o', description: 'Write blank template to file' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaBlankTemplate);
    try {
      const result = await this.api(flags, 'GET', '/schemas/_blank');

      if (flags.output) {
        writeFileSync(flags.output, JSON.stringify(result, null, 2) + '\n', 'utf-8');
        if (!this.isJson) {
          process.stderr.write(`Blank template written to ${flags.output}\n`);
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
