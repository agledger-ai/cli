import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class SchemaDeprecate extends BaseCommand {
  static override description = 'Deprecate a schema version';
  static override args = {
    type: Args.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    version: Flags.integer({ description: 'Version number to deprecate', required: true }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without hitting the API', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaDeprecate);
    try {
      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would deprecate:\n');
        this.output({ contractType: args.type, version: flags.version, status: 'DEPRECATED' });
        return;
      }

      const result = await this.api(flags, 'PATCH', `/schemas/${args.type}/versions/${flags.version}`, {
        body: { status: 'DEPRECATED' },
      });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
