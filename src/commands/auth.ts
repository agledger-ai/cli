import { BaseCommand } from '../base.js';

/**
 * Quick "am I logged in?" check. Local-first: returns `authenticated: false`
 * with exit 0 when no credential is configured (useful for scripts gating on
 * login state). Otherwise verifies the credential via GET /v1/auth/me. With an
 * OIDC token source, that call runs one cert exchange, and the cert the Server
 * issued (id, agent, issuer, subject, scopes, lifetime) is shown beside the
 * identity.
 */
export default class Auth extends BaseCommand {
  static override description =
    'Check current authentication status, including the OIDC cert identity when a token source is configured. Returns `authenticated: false` when no credential is configured (exit 0).';

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);
    // Resolve the credential the same way an actual call does. An earlier
    // check looked only at the flag/env, so `agledger auth` reported
    // not-authenticated right after a successful `login` wrote a profile.
    const auth = this.resolvedAuth(flags);
    if (auth.credential === 'none') {
      this.output({
        authenticated: false,
        message:
          'No credential configured. Set AGLEDGER_API_KEY, AGLEDGER_OIDC_TOKEN_CMD or AGLEDGER_OIDC_TOKEN_FILE, or run `agledger login`.',
      });
      return;
    }
    try {
      const client = this.createApiClient(flags);
      const response = await client.request('GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }
      const cert = client.credential?.cert;
      this.output({
        authenticated: true,
        source: auth.source,
        credential: auth.credential,
        ...(auth.oidcTokenSource ? { oidcTokenSource: auth.oidcTokenSource } : {}),
        ...(auth.profile ? { profile: auth.profile } : {}),
        ...(cert ? { cert } : {}),
        account: response.body,
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
