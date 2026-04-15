import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class WebhookCreate extends BaseCommand {
  static override description = 'Create a webhook subscription';
  static override flags = {
    ...BaseCommand.baseFlags,
    url: Flags.string({ description: 'Webhook endpoint URL', required: true }),
    events: Flags.string({ description: 'Comma-separated event types (e.g., mandate.created,receipt.submitted)', required: true }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without hitting the API', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WebhookCreate);
    try {
      const eventTypes = flags.events.split(',').map((e) => e.trim());
      const body = { url: flags.url, eventTypes };

      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output(body);
        return;
      }

      const result = await this.api(flags, 'POST', '/webhooks', { body });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
