import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AdminSetConfig extends BaseCommand {
  static override description = 'Set an enterprise\'s approval configuration (PUT). Omitted fields are removed.';
  static override args = {
    enterpriseId: Args.string({ description: 'Enterprise ID to configure', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    data: Flags.string({ description: 'Config as JSON string' }),
    file: Flags.file({ description: 'Read config from JSON file' }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without calling the API', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AdminSetConfig);
    try {
      let config: Record<string, unknown> = {};
      if (flags.file) {
        config = JSON.parse(readFileSync(flags.file, 'utf-8'));
      } else if (flags.data) {
        config = JSON.parse(flags.data);
      } else {
        this.failWith('MISSING_INPUT', 'Provide config via --data or --file.', 2, 'Example: --data \'{"agentApprovalRequired":true}\'');
      }

      if (flags['dry-run']) {
        process.stderr.write(`Dry run \u2014 would set config for ${args.enterpriseId}:\n`);
        this.output(config);
        return;
      }

      const result = await this.api(flags, 'PUT', `/enterprises/${args.enterpriseId}/approval-config`, { body: config });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
