import { resolve } from 'node:path';
import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { BaseCommand, ErrorCode, ExitCode, argvHasFlag } from '../base.js';
import { OIDC_ENV, fetchOidcToken } from '../oidc.js';
import { readConfig, writeConfig, type Profile } from '../util/config.js';

/**
 * Verify a credential against the API, then persist it to
 * ~/.agledger/config.json (0600, dir 0700). Supports named profiles so one
 * machine can hold credentials for several Servers.
 *
 * `--oidc` stores an OIDC token SOURCE (a command or a file path), never a
 * token, cert or key. Every later command runs the source again and exchanges
 * the token for a fresh cert held in memory for that one invocation.
 */
export default class Login extends BaseCommand {
  static override description =
    'Verify an API key, or an OIDC token source with --oidc, and store it in ~/.agledger/config.json (0600)';

  static override examples = [
    '<%= config.bin %> login --api-url https://agledger.internal --api-key agl_agt_... --profile prod',
    "<%= config.bin %> login --oidc --api-url https://agledger.internal --oidc-token-cmd 'gcloud auth print-identity-token --audiences=agledger'",
    '<%= config.bin %> login --oidc --api-url https://agledger.internal --oidc-token-file /var/run/secrets/tokens/agledger',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name', default: 'default' }),
    oidc: Flags.boolean({
      description:
        'Store an OIDC token source instead of an API key. A token command is verified by one cert exchange and a GET /v1/auth/me before it is saved. A token file is only checked to hold a JWT: the Server exchanges each token once, so exchanging it here would leave the next command a spent token until the file rotates.',
      default: false,
    }),
    'oidc-token-cmd': Flags.string({
      description: 'With --oidc: a shell command whose stdout is an OIDC JWT, run on every cert exchange.',
      env: OIDC_ENV.TOKEN_CMD,
    }),
    'oidc-token-file': Flags.string({
      description: 'With --oidc: a file holding an OIDC JWT, read on every cert exchange (a projected token in a pod).',
      env: OIDC_ENV.TOKEN_FILE,
    }),
    'oidc-agent-id': Flags.string({
      description: 'With --oidc: the agent the cert binds to, when the token does not map to one itself.',
      env: OIDC_ENV.AGENT_ID,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    if (flags.oidc) {
      await this.loginOidc(flags);
      return;
    }
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        'Provide --api-key or set AGLEDGER_API_KEY.',
        ExitCode.AUTH_ERROR,
        'To store an OIDC token source instead of a key, run `agledger login --oidc`.',
      );
    }
    try {
      const response = await this.callApi(flags, 'GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }

      this.save(flags.profile, { apiKey: apiKey!, apiUrl: flags['api-url'] || undefined });
      this.output({ authenticated: true, profile: flags.profile, account: response.body });
    } catch (err) {
      this.handleError(err);
    }
  }

  private async loginOidc(flags: {
    profile: string;
    verbose: boolean;
    'api-key'?: string;
    'api-url'?: string;
    'oidc-token-cmd'?: string;
    'oidc-token-file'?: string;
    'oidc-agent-id'?: string;
  }): Promise<void> {
    if (flags['api-key']) {
      this.failWith(
        ErrorCode.MISSING_INPUT,
        '--oidc stores an OIDC token source, but an API key was also supplied.',
        ExitCode.USAGE_ERROR,
        'Drop --api-key and unset AGLEDGER_API_KEY, or run `agledger login` without --oidc to store the key.',
      );
    }
    const command = flags['oidc-token-cmd'] || undefined;
    // Stored absolute: later commands run from other directories.
    const file = flags['oidc-token-file'] ? resolve(flags['oidc-token-file']) : undefined;
    if (!command && !file) {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        '--oidc needs a token source.',
        ExitCode.AUTH_ERROR,
        'Pass --oidc-token-cmd <command> (or set AGLEDGER_OIDC_TOKEN_CMD), or --oidc-token-file <path> (or set AGLEDGER_OIDC_TOKEN_FILE).',
      );
    }
    const apiUrl = flags['api-url'] || undefined;
    if (!apiUrl) {
      this.failWith(
        ErrorCode.CONFIG_ERROR,
        'No API URL configured. AGLedger is self-hosted, so there is no default server to call.',
        ExitCode.USAGE_ERROR,
        'Pass --api-url <url> or set AGLEDGER_API_URL.',
      );
    }

    // The command outranks the file, as it does at call time.
    const source = command
      ? { kind: 'command' as const, command, origin: argvHasFlag('--oidc-token-cmd') ? '--oidc-token-cmd' : OIDC_ENV.TOKEN_CMD }
      : { kind: 'file' as const, path: file!, origin: argvHasFlag('--oidc-token-file') ? '--oidc-token-file' : OIDC_ENV.TOKEN_FILE };
    const agentId = flags['oidc-agent-id'] || undefined;
    const stored = {
      apiUrl,
      oidc: {
        ...(command ? { tokenCommand: command } : { tokenFile: file! }),
        ...(agentId ? { agentId } : {}),
      },
    };

    if (source.kind === 'file') {
      // No exchange: the file returns the same token until it rotates, and the
      // Server exchanges a token id once, so a check here would spend the token
      // the next command needs. Confirm it holds a JWT and save.
      try {
        const { sub } = await fetchOidcToken(source);
        this.save(flags.profile, stored);
        this.output({
          saved: true,
          verified: false,
          profile: flags.profile,
          credential: 'oidc-cert',
          tokenSource: 'file',
          oidcSub: sub,
          message:
            'The file holds a JWT; it was not exchanged, so the token stays unspent. Run `agledger auth` to exchange it and see the cert.',
        });
      } catch (err) {
        this.handleError(err);
      }
      return;
    }

    const credential = this.oidcCredential(flags, { source, ...(agentId ? { agentId } : {}) });
    this.verboseLog(flags, { event: 'auth', credential: 'oidc-cert', source: source.origin, apiUrl });

    try {
      const client = new ApiClient(apiUrl!, credential, this.config.version);
      const response = await client.request('GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }

      this.save(flags.profile, stored);
      this.output({
        authenticated: true,
        profile: flags.profile,
        credential: 'oidc-cert',
        tokenSource: 'command',
        cert: credential.cert,
        account: response.body,
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  private save(name: string, profile: Profile): void {
    const config = readConfig();
    config.profiles[name] = profile;
    config.activeProfile = name;
    writeConfig(config);
  }
}
