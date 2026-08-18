import { Flags } from '@oclif/core';
import { BaseCommand } from '../base.js';

/**
 * Fetch the API's agent-oriented documentation narrative. The API serves a
 * concise `/llms.txt` and an expanded `/llms-full.txt` (the llms.txt
 * convention); `discover` only points at `openapi.json`, so this closes the
 * loop for an agent that wants the prose narrative without reaching for curl.
 */
export default class Docs extends BaseCommand {
  static override description =
    "Fetch the API's agent-oriented documentation narrative (llms.txt / llms-full.txt).";

  static override examples = [
    '<%= config.bin %> docs',
    '<%= config.bin %> docs --full',
    '<%= config.bin %> docs --full > agledger-llms.txt',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    full: Flags.boolean({
      description: 'Fetch the expanded llms-full.txt narrative instead of the concise llms.txt.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Docs);
    // llms.txt is served unauthenticated: an agent holding only a URL must be
    // able to read the narrative before it has a key (agents#104).
    const client = this.createApiClient(flags, { allowAnonymous: true });
    const path = flags.full ? '/llms-full.txt' : '/llms.txt';

    const res = await client.request('GET', path);
    const text =
      res.body && typeof res.body === 'object' && '_raw' in res.body
        ? String((res.body as { _raw: unknown })._raw)
        : typeof res.body === 'string'
          ? res.body
          : JSON.stringify(res.body, null, 2);

    if (this.isJson) {
      this.output({ path, content: text });
    } else if (!this.isQuiet) {
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    }
  }
}
