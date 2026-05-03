import { BaseCommand } from '../base.js';

/**
 * Low-token command inventory for agent discovery.
 *
 * The CLI is a thin cover over the API — the bulk of functionality lives under
 * `agledger api <METHOD> <path>`. This list shows CLI-local commands only;
 * for API operations, agents should call `agledger discover` or
 * `agledger api GET /openapi.json`.
 */
export default class ListCommands extends BaseCommand {
  static override description = 'List all CLI commands (for agent discovery). Most API work goes through `agledger api`.';

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    await this.parse(ListCommands);
    const commands = [
      { name: 'api', description: 'Call any AGLedger API endpoint (thin pass-through). Start here.' },
      { name: 'discover', description: 'Check API health, current identity, scopes, and quickstart workflow.' },
      { name: 'login', description: 'Verify an API key and store it in ~/.agledger/config.json (0600).' },
      { name: 'logout', description: 'Remove a stored profile.' },
      { name: 'auth', description: 'Check current authentication status (exit 0 whether logged in or not).' },
      { name: 'config', description: 'Inspect or switch between stored profiles (list, get, use, path).' },
      { name: 'verify', description: 'Verify an audit export offline (hash chain + Ed25519 signatures).' },
      { name: 'list-commands', description: 'List all CLI commands (this).' },
      { name: 'help-json', description: 'Get JSON schema for a specific CLI command.' },
    ];
    this.output({
      commands,
      note: 'For API operations (records, receipts, schemas, webhooks, etc.), use `agledger api <METHOD> <path>`. See `agledger discover` for the workflow.',
    });
  }
}
