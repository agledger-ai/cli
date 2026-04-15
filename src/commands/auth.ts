import { BaseCommand } from '../base.js';

export default class Auth extends BaseCommand {
  static override description = 'Check current authentication status';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.output({ authenticated: false, message: 'No API key configured' });
      return;
    }
    try {
      const result = await this.api(flags, 'GET', '/auth/me');
      this.output({ authenticated: true, account: result });
    } catch (err) {
      this.handleError(err);
    }
  }
}
