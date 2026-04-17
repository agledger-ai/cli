import { Flags } from '@oclif/core';
import { BaseCommand } from '../base.js';
import { readConfig, writeConfig } from '../util/config.js';

export default class Logout extends BaseCommand {
  static override description = 'Remove a stored profile from ~/.agledger/config.json';

  static override flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({ description: 'Profile name to remove', default: 'default' }),
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

    if (!config.profiles[flags.profile]) {
      this.output({ loggedOut: false, message: `No profile '${flags.profile}' found.` });
      return;
    }

    delete config.profiles[flags.profile];
    if (config.activeProfile === flags.profile) {
      const remaining = Object.keys(config.profiles);
      config.activeProfile = remaining[0];
    }
    writeConfig(config);
    this.output({ loggedOut: true, profile: flags.profile, activeProfile: config.activeProfile });
  }
}
