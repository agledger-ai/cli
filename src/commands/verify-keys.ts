import { BaseCommand } from '../base.js';

export default class VerifyKeys extends BaseCommand {
  static override description = 'List vault signing public keys for independent audit chain verification';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(VerifyKeys);
    try {
      const result = await this.api(flags, 'GET', '/verification-keys');
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
