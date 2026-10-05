import { Flags } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';
import { readConfig, writeConfig } from '../util/config.js';

export default class Logout extends BaseCommand {
  static override description =
    'Remove a stored profile from ~/.agledger/config.json: the active profile, the one named by --profile, or every profile with --all. Exits 2 when there is no such profile to remove. Removing the active profile leaves none active: pick another with `config use`.';

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
      if (removed.length === 0) {
        this.failWith(
          ErrorCode.MISSING_INPUT,
          'No profiles are stored, so nothing was removed.',
          ExitCode.USAGE_ERROR,
          'Run `agledger login` to store one.',
        );
      }
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
    // Logging out the active profile leaves none active. Promoting whichever
    // profile came first would quietly switch the next call to a different
    // identity (an admin key, say), so the caller picks one with `config use`.
    const wasActive = config.activeProfile === name;
    if (wasActive) delete config.activeProfile;
    writeConfig(config);
    const remaining = Object.keys(config.profiles);
    this.output({
      loggedOut: true,
      profile: name,
      activeProfile: config.activeProfile ?? null,
      ...(wasActive && remaining.length > 0
        ? { note: `No profile is active now. Run \`agledger config use <name>\` to choose one of: ${remaining.join(', ')}.` }
        : {}),
    });
  }
}
