import { BaseCommand } from '../base.js';

export default class Status extends BaseCommand {
  static override description = 'Check AGLedger API health and status';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    try {
      const result = await this.api(flags, 'GET', '/health');
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
