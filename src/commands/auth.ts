import { BaseCommand } from '../base.js';

/**
 * Quick "am I logged in?" check. Local-first — returns `authenticated: false`
 * with exit 0 when no key is configured (useful for scripts gating on login state).
 * When a key is configured, verifies it against the API via GET /v1/auth/me.
 */
export default class Auth extends BaseCommand {
  static override description =
    'Check current authentication status. Returns `authenticated: false` when no key is configured (exit 0).';

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.output({ authenticated: false, message: 'No API key configured. Run `agledger login --api-key <key>`.' });
      return;
    }
    try {
      const response = await this.callApi(flags, 'GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }
      this.output({ authenticated: true, account: response.body });
    } catch (err) {
      this.handleError(err);
    }
  }
}
