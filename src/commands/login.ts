import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Flags } from '@oclif/core';
import { BaseCommand, ExitCode } from '../base.js';

export default class Login extends BaseCommand {
  static override description = 'Authenticate and store credentials in ~/.agledger/';
  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name', default: 'default' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.failWith('AUTH_REQUIRED', 'Provide --api-key or set AGLEDGER_API_KEY.', ExitCode.AUTH_ERROR);
    }
    try {
      const me = await this.api(flags, 'GET', '/auth/me');

      const configDir = join(homedir(), '.agledger');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      const configPath = join(configDir, 'config.json');
      const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : { profiles: {} };
      config.profiles[flags.profile] = { apiKey: apiKey!, apiUrl: flags['api-url'] || undefined };
      config.activeProfile = flags.profile;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      this.output({ authenticated: true, profile: flags.profile, account: me });
    } catch (err) {
      this.handleError(err);
    }
  }
}
