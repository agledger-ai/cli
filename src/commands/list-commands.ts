import { BaseCommand } from '../base.js';

/** Low-token command inventory for agent discovery (~50 tokens). */
export default class ListCommands extends BaseCommand {
  static override description = 'List all available commands (agent discovery)';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    await this.parse(ListCommands);
    const commands = [
      { name: 'mandate list', description: 'List mandates with filtering' },
      { name: 'mandate get', description: 'Get mandate details' },
      { name: 'mandate create', description: 'Create a new mandate' },
      { name: 'mandate cancel', description: 'Cancel a mandate' },
      { name: 'mandate transition', description: 'Transition mandate state' },
      { name: 'mandate accept', description: 'Accept a proposed mandate' },
      { name: 'mandate reject', description: 'Reject a proposed mandate' },
      { name: 'mandate counter-propose', description: 'Counter-propose revised terms' },
      { name: 'mandate batch', description: 'Batch-get multiple mandates by ID' },
      { name: 'mandate chain', description: 'Get delegation chain' },
      { name: 'mandate request-revision', description: 'Request revision after rejection' },
      { name: 'mandate outcome', description: 'Report principal verdict on a receipt (PASS/FAIL)' },
      { name: 'receipt list', description: 'List receipts for a mandate' },
      { name: 'receipt get', description: 'Get receipt details' },
      { name: 'receipt submit', description: 'Submit evidence of completion' },
      { name: 'verdict render', description: 'Accept or reject delivered work' },
      { name: 'webhook list', description: 'List webhook subscriptions' },
      { name: 'webhook create', description: 'Create a webhook' },
      { name: 'webhook delete', description: 'Delete a webhook' },
      { name: 'audit trail', description: 'Get hash-chained audit trail' },
      { name: 'audit events', description: 'List audit events' },
      { name: 'agent list', description: 'List agents in enterprise' },
      { name: 'agent reputation', description: 'Get agent reputation score' },
      { name: 'login', description: 'Authenticate and store credentials' },
      { name: 'auth', description: 'Check authentication status' },
      { name: 'status', description: 'Check API health and status' },
      { name: 'schema list', description: 'List contract type schemas' },
      { name: 'schema get', description: 'Get full schema for a contract type' },
      { name: 'schema rules', description: 'Get verification rules for a contract type' },
      { name: 'schema register', description: 'Register a custom contract type schema' },
      { name: 'schema preview', description: 'Preview a schema before registration' },
      { name: 'schema validate', description: 'Validate receipt evidence against a schema' },
      { name: 'schema versions', description: 'List versions of a contract type schema' },
      { name: 'schema diff', description: 'Diff two schema versions' },
      { name: 'schema export', description: 'Export a schema bundle to file' },
      { name: 'schema import', description: 'Import a schema bundle from file' },
      { name: 'schema deprecate', description: 'Deprecate a schema version' },
      { name: 'schema meta-schema', description: 'Get meta-schema for custom schema authoring' },
      { name: 'schema blank-template', description: 'Get a blank template for custom contract types' },
      { name: 'schema template', description: 'Get a starter template from an existing contract type' },
      { name: 'schema get-version', description: 'Get a specific version of a contract type schema' },
      { name: 'schema check-compatibility', description: 'Check backward/forward compatibility of schema changes' },
      { name: 'admin create-agent', description: 'Create a new agent (platform admin)' },
      { name: 'admin create-enterprise', description: 'Create a new enterprise (platform admin)' },
      { name: 'admin set-config', description: 'Replace enterprise configuration' },
      { name: 'federation health', description: 'Federation health summary' },
      { name: 'federation list-gateways', description: 'List federation gateways' },
      { name: 'federation create-token', description: 'Create a gateway registration token' },
      { name: 'federation revoke-gateway', description: 'Revoke a federation gateway' },
      { name: 'federation audit-log', description: 'Query federation audit log' },
      { name: 'federation query-mandates', description: 'Query federated mandates' },
      { name: 'verify-keys', description: 'List vault signing public keys' },
      { name: 'list-commands', description: 'List all commands (this)' },
      { name: 'help-json', description: 'Get JSON schema for a command' },
    ];
    this.output({ commands } as unknown as Record<string, unknown>);
  }
}
