import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class WebhookList extends BaseCommand {
  static override description = 'List registered webhooks, optionally filtered by exact URL';
  static override flags = {
    ...BaseCommand.baseFlags,
    url: Flags.string({ description: 'Filter by exact webhook URL' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WebhookList);
    try {
      const query: Record<string, unknown> = {};
      if (flags.url) query.url = flags.url;
      const result = await this.api(flags, 'GET', '/webhooks', { query });
      this.outputPage(result as { data: unknown[] }, ['id', 'url', 'events', 'createdAt']);
    } catch (err) {
      this.handleError(err);
    }
  }
}
