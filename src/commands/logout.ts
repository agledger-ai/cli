import { Flags } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';
import { readConfig, writeConfig } from '../util/config.js';

export default class Logout extends BaseCommand {
  static override description =
    'Remove a stored profile from ~/.agledger/config.json: the active profile, the one named by --profile, or every profile with --all. Exits 2 when there is no such profile to remove.';

  static override examples = [
    '<%= config.bin %> logout',
    '<%= config.bin %> logout --profile prod',
    '<%= config.bin %> logout --all',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name to remove (default: the active profile)' }),
    all: Flags.boolean({ description: 'Remove all profiles', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout);
    const config = readConfig();

    if (flags.all) {
      const removed = Object.keys(config.profiles);
      writeConfig({ profiles: {} });
      this.output({ loggedOut: true, removedProfiles: removed });
      return;
    }

    // The profile a plain command authenticates with is the active one, so
    // that is the one a plain logout removes. Removing nothing is an error,
    // not a quiet success: the caller would otherwise stay logged in.
    const name = flags.profile ?? config.activeProfile;
    if (!name) {
      this.failWith(
        ErrorCode.MISSING_INPUT,
        'No active profile, so there is nothing to log out of.',
        ExitCode.USAGE_ERROR,
        'Run `agledger config list` to see profiles, then `agledger logout --profile <name>`.',
      );
    }
    if (!config.profiles[name]) {
      this.failWith(
        ErrorCode.MISSING_INPUT,
        `Profile '${name}' not found, so nothing was removed.`,
        ExitCode.USAGE_ERROR,
        'Run `agledger config list` to see profiles.',
      );
    }

    delete config.profiles[name];
    if (config.activeProfile === name) {
      const remaining = Object.keys(config.profiles);
      config.activeProfile = remaining[0];
    }
    writeConfig(config);
    this.output({ loggedOut: true, profile: name, activeProfile: config.activeProfile });
  }
}
