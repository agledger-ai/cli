import { BaseCommand } from '../../base.js';

export default class FederationHealth extends BaseCommand {
  static override description = 'Show federation health summary (gateway counts, sync status, uptime).';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationHealth);
    try {
      const result = await this.api(flags, 'GET', '/federation/v1/admin/health');
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
