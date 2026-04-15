import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class FederationRevokeGateway extends BaseCommand {
  static override description = 'Revoke a federation gateway, severing its connection to the hub.';
  static override args = {
    gateway_id: Args.string({ description: 'Gateway ID to revoke', required: true }),
  };
  static override flags = {
    ...BaseCommand.baseFlags,
    reason: Flags.string({ description: 'Reason for revocation', required: true }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without calling the API', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FederationRevokeGateway);
    try {
      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output({ gatewayId: args.gateway_id, reason: flags.reason });
        return;
      }

      const result = await this.api(flags, 'POST', `/federation/v1/admin/gateways/${args.gateway_id}/revoke`, {
        body: { reason: flags.reason },
      });
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
