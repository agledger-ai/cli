import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class FederationCreateToken extends BaseCommand {
  static override description = 'Create a federation registration token for gateway onboarding.';
  static override flags = {
    ...BaseCommand.baseFlags,
    label: Flags.string({ description: 'Human-readable label for the token' }),
    'expires-in-hours': Flags.integer({ description: 'Token expiry in hours (default: server-configured)' }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without calling the API', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationCreateToken);
    try {
      const body: Record<string, unknown> = {};
      if (flags.label) body.label = flags.label;
      if (flags['expires-in-hours']) body.expiresInHours = flags['expires-in-hours'];

      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output(body);
        return;
      }

      const result = await this.api(flags, 'POST', '/federation/v1/admin/registration-tokens', { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
