import { BaseCommand } from '../base.js';

/**
 * Cold-start discovery for agents and humans. Mirrors the MCP server's
 * `agledger_discover` tool — same shape, same quickstart.
 *
 * Returns health, identity, scopes, a 4-step quickstart workflow, and pointers
 * to live API discovery (OpenAPI + Swagger UI). Failures on either call don't
 * abort — partial results are returned so agents can reason about what's reachable.
 */
export default class Discover extends BaseCommand {
  static override description =
    'Check API health and current identity, and return the quickstart workflow. Call this first.';

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Discover);
    const client = this.createApiClient(flags);

    const [health, identity] = await Promise.allSettled([
      client.request('GET', '/health'),
      client.request('GET', '/v1/auth/me'),
    ]);

    const result: Record<string, unknown> = {};

    result.health = health.status === 'fulfilled'
      ? health.value.body
      : { error: health.reason instanceof Error ? health.reason.message : String(health.reason) };

    result.identity = identity.status === 'fulfilled'
      ? identity.value.body
      : { error: identity.reason instanceof Error ? identity.reason.message : String(identity.reason) };

    result.quickstart = {
      description: 'To track accountability for your work, follow these steps in order:',
      steps: [
        { step: 1, action: 'List available contract types', command: 'agledger api GET /v1/schemas' },
        { step: 2, action: 'Get schema for your contract type', command: 'agledger api GET /v1/schemas/{contractType}' },
        { step: 3, action: 'Create a mandate', command: 'agledger api POST /v1/mandates --data \'{...}\'' },
        { step: 4, action: 'Submit a receipt when done', command: 'agledger api POST /v1/mandates/{id}/receipts --data \'{...}\'' },
      ],
    };

    result.docs = {
      description: 'Every API response includes `nextSteps` for self-guided workflow discovery.',
      openapi: '`agledger api GET /openapi.json` returns the full route catalog.',
      swaggerUi: 'Your instance serves interactive Swagger UI at /docs.',
    };

    this.output(result);
  }
}
