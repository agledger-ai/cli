import { writeFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaMetaSchema extends BaseCommand {
  static override description = 'Get the meta-schema for custom schema authoring';
  static override flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({ char: 'o', description: 'Write meta-schema to file (e.g., for VS Code json.schemas)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaMetaSchema);
    try {
      const result = await this.api(flags, 'GET', '/schemas/meta-schema');

      if (flags.output) {
        writeFileSync(flags.output, JSON.stringify(result, null, 2) + '\n', 'utf-8');
        if (!this.isJson) {
          process.stderr.write(`Meta-schema written to ${flags.output}\n`);
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
