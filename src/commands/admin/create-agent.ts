import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AdminCreateAgent extends BaseCommand {
  static override description = 'Create a new agent (platform admin). Slug is auto-generated if omitted.';
  static override flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: 'Display name for the agent', required: true }),
    slug: Flags.string({ description: 'URL-safe slug (auto-generated from name if omitted)' }),
    email: Flags.string({ description: 'Contact email' }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without calling the API', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AdminCreateAgent);
    try {
      const body: Record<string, unknown> = { name: flags.name };
      if (flags.slug) body.slug = flags.slug;
      if (flags.email) body.email = flags.email;

      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output(body);
        return;
      }

      const result = await this.api(flags, 'POST', '/admin/agents', { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
