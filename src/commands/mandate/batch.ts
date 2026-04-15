import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateBatch extends BaseCommand {
  static override description = 'Fetch multiple mandates by ID (up to 100). Outputs NDJSON.';
  static override flags = {
    ...BaseCommand.baseFlags,
    ids: Flags.string({ description: 'Comma-separated mandate IDs', required: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MandateBatch);
    try {
      const ids = flags.ids.split(',').map((id) => id.trim()).filter(Boolean);
      const result = await this.api(flags, 'POST', '/mandates/batch', { body: { ids } });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
