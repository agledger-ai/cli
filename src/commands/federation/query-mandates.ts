import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class FederationQueryMandates extends BaseCommand {
  static override description = 'Query federated mandates across gateways.';
  static override flags = {
    ...BaseCommand.baseFlags,
    'gateway-id': Flags.string({ description: 'Filter by originating gateway ID' }),
    'hub-state': Flags.string({
      description: 'Filter by hub-side mandate state',
      options: ['OFFERED', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'DISPUTED', 'TERMINAL'],
    }),
    'contract-type': Flags.string({ description: 'Filter by contract type (e.g. ACH-PROC-v1)' }),
    limit: Flags.integer({ description: 'Maximum number of results to return' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationQueryMandates);
    try {
      const query: Record<string, unknown> = {};
      if (flags['gateway-id']) query.gatewayId = flags['gateway-id'];
      if (flags['hub-state']) query.hubState = flags['hub-state'];
      if (flags['contract-type']) query.contractType = flags['contract-type'];
      if (flags.limit) query.limit = flags.limit;

      const result = await this.api(flags, 'GET', '/federation/v1/admin/mandates', { query });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
