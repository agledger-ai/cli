import { writeFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaExport extends BaseCommand {
  static override description = 'Export a contract type schema bundle to a file';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({ char: 'o', description: 'Output file path (required)', required: true }),
    versions: Flags.string({ description: 'Comma-separated version numbers to export (e.g., "1,2")' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaExport);
    try {
      const query: Record<string, unknown> = {};
      if (flags.versions) query.versions = flags.versions;
      const result = await this.api(flags, 'POST', `/schemas/${args.type}/export`, { query });

      writeFileSync(flags.output, JSON.stringify(result, null, 2) + '\n', 'utf-8');
      if (!this.isJson) {
        process.stderr.write(`Exported ${args.type} to ${flags.output}\n`);
      } else {
        this.output({ exported: true, file: flags.output, contractType: args.type });
      }
    } catch (err) {
      this.handleError(err);
    }
  }
}
