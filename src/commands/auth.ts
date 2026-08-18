import { BaseCommand } from '../base.js';

/**
 * Quick "am I logged in?" check. Local-first: returns `authenticated: false`
 * with exit 0 when no key is configured (useful for scripts gating on login state).
 * When a key is configured, verifies it against the API via GET /v1/auth/me.
 */
export default class Auth extends BaseCommand {
  static override description =
    'Check current authentication status. Returns `authenticated: false` when no key is configured (exit 0).';

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);
    // Resolve the key the same way an actual call does: --api-key flag > env >
    // stored profile in ~/.agledger/config.json. The previous check looked only
    // at the flag/env, so `agledger auth` reported not-authenticated right after
    // a successful `login` wrote the key to a profile (cross-repo #94).
    const auth = this.resolvedAuth(flags);
    if (auth.source === 'none') {
      this.output({ authenticated: false, message: 'No API key configured. Run `agledger login --api-key <key>`.' });
      return;
    }
    try {
      const response = await this.callApi(flags, 'GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }
      this.output({
        authenticated: true,
        source: auth.source,
        ...(auth.profile ? { profile: auth.profile } : {}),
        account: response.body,
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
