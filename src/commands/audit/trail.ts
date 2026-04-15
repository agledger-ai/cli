import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AuditTrail extends BaseCommand {
  static override description = 'Get the hash-chained audit trail for a mandate';
  static override args = {
    mandateId: Args.string({ description: 'Mandate ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AuditTrail);
    try {
      const result = await this.api(flags, 'GET', `/mandates/${args.mandateId}/audit`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
