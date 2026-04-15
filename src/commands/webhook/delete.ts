import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class WebhookDelete extends BaseCommand {
  static override description = 'Delete a webhook subscription';
  static override args = {
    id: Args.string({ description: 'Webhook ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookDelete);
    try {
      await this.api(flags, 'DELETE', `/webhooks/${args.id}`);
      this.output({ deleted: true, id: args.id });
    } catch (err) {
      this.handleError(err);
    }
  }
}
