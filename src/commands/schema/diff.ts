import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';
import { formatDiff } from '../../util/diff-formatter.js';

export default class SchemaDiff extends BaseCommand {
  static override description = 'Diff two versions of a contract type schema';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    from: Flags.integer({ description: 'Source version number', required: true }),
    to: Flags.integer({ description: 'Target version number', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaDiff);
    try {
      const result = await this.api(flags, 'GET', `/schemas/${args.type}/diff`, {
        query: { from: flags.from, to: flags.to },
      });

      if (this.isJson) {
        this.output(result);
      } else {
        process.stdout.write(formatDiff(result as unknown as Parameters<typeof formatDiff>[0]));
      }
    } catch (err) {
      this.handleError(err);
    }
  }
}
