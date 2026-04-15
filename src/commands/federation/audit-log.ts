import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class FederationAuditLog extends BaseCommand {
  static override description = 'Query the federation audit log for gateway and mandate events.';
  static override flags = {
    ...BaseCommand.baseFlags,
    'gateway-id': Flags.string({ description: 'Filter by gateway ID' }),
    'entry-type': Flags.string({ description: 'Filter by audit entry type' }),
    'mandate-id': Flags.string({ description: 'Filter by mandate ID' }),
    limit: Flags.integer({ description: 'Maximum number of entries to return' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationAuditLog);
    try {
      const query: Record<string, unknown> = {};
      if (flags['gateway-id']) query.gatewayId = flags['gateway-id'];
      if (flags['entry-type']) query.entryType = flags['entry-type'];
      if (flags['mandate-id']) query.mandateId = flags['mandate-id'];
      if (flags.limit) query.limit = flags.limit;

      const result = await this.api(flags, 'GET', '/federation/v1/admin/audit-log', { query });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
