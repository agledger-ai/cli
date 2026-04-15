import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class FederationListGateways extends BaseCommand {
  static override description = 'List federation gateways with optional status filter.';
  static override flags = {
    ...BaseCommand.baseFlags,
    status: Flags.string({
      description: 'Filter by gateway status',
      options: ['active', 'suspended', 'revoked'],
    }),
    limit: Flags.integer({ description: 'Maximum number of results to return' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationListGateways);
    try {
      const query: Record<string, unknown> = {};
      if (flags.status) query.status = flags.status;
      if (flags.limit) query.limit = flags.limit;

      const result = await this.api(flags, 'GET', '/federation/v1/admin/gateways', { query });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
