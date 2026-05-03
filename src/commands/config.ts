import { Args, Flags } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';
import { configPath, readConfig, writeConfig } from '../util/config.js';

/**
 * Inspect and switch between stored profiles in ~/.agledger/config.json.
 *
 * Does NOT accept setting an API key directly — use `agledger login --api-key X
 * --profile name` for that (login also verifies the key against the API first).
 */
export default class Config extends BaseCommand {
  static override description = 'Inspect or switch between stored profiles in ~/.agledger/config.json';

  static override examples = [
    'agledger config list                # list all profiles',
    'agledger config get                  # show active profile',
    'agledger config get --profile prod   # show a specific profile',
    'agledger config use prod             # set prod as the active profile',
    'agledger config path                 # print the config file path',
  ];

  static override args = {
    action: Args.string({
      description: 'Action: list, get, use, path',
      required: true,
      options: ['list', 'get', 'use', 'path'],
    }),
    profile: Args.string({ description: 'Profile name (for `use`)' }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name to inspect (for `get`)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Config);
    const config = readConfig();

    switch (args.action) {
      case 'path':
        this.output({ path: configPath() });
        return;

      case 'list': {
        const profiles = Object.entries(config.profiles).map(([name, p]) => ({
          name,
          apiUrl: p.apiUrl,
          active: name === config.activeProfile,
        }));
        this.output({ activeProfile: config.activeProfile, profiles });
        return;
      }

      case 'get': {
        const name = flags.profile ?? config.activeProfile;
        if (!name) {
          this.failWith(
            ErrorCode.MISSING_INPUT,
            'No active profile. Run `agledger config list` or `agledger login`.',
            ExitCode.USAGE_ERROR,
          );
        }
        const profile = config.profiles[name];
        if (!profile) {
          this.failWith(
            ErrorCode.MISSING_INPUT,
            `Profile '${name}' not found.`,
            ExitCode.USAGE_ERROR,
            `Run \`agledger config list\` to see profiles.`,
          );
        }
        this.output({ name, apiUrl: profile.apiUrl, active: name === config.activeProfile });
        return;
      }

      case 'use': {
        const target = args.profile;
        if (!target) {
          this.failWith(
            ErrorCode.MISSING_INPUT,
            '`config use` requires a profile name.',
            ExitCode.USAGE_ERROR,
            'Example: agledger config use prod',
          );
        }
        if (!config.profiles[target!]) {
          this.failWith(
            ErrorCode.MISSING_INPUT,
            `Profile '${target}' not found.`,
            ExitCode.USAGE_ERROR,
            'Run `agledger config list` to see profiles, or `agledger login --profile <name>` to create one.',
          );
        }
        config.activeProfile = target;
        writeConfig(config);
        this.output({ activeProfile: target });
        return;
      }
    }
  }
}
