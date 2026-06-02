import { Flags } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';
import { readConfig, writeConfig } from '../util/config.js';

/**
 * Verify the provided key against the API, then persist it to ~/.agledger/config.json
 * (0600, dir 0700). Supports named profiles so one machine can hold keys for multiple
 * instances/environments.
 */
export default class Login extends BaseCommand {
  static override description = 'Verify an API key and store it in ~/.agledger/config.json (0600)';

  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name', default: 'default' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        'Provide --api-key or set AGLEDGER_API_KEY.',
        ExitCode.AUTH_ERROR,
      );
    }
    try {
      const response = await this.callApi(flags, 'GET', '/v1/auth/me');
      if (!response.ok) {
        this.handleApiError(response);
      }

      const config = readConfig();
      config.profiles[flags.profile] = { apiKey: apiKey!, apiUrl: flags['api-url'] || undefined };
      config.activeProfile = flags.profile;
      writeConfig(config);

      this.output({ authenticated: true, profile: flags.profile, account: response.body });
    } catch (err) {
      this.handleError(err);
    }
  }
}
