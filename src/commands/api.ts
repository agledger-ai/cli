import { Args, Flags } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';
import { parseFields, FieldParseError } from '../util/field-parser.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Universal pass-through to the AGLedger API.
 *
 * Design principle: the CLI is a thin cover over the API. This command supports
 * every route the API exposes with zero drift — no hand-coded flag-to-body mapping.
 *
 * Params go to query string for GET/DELETE, to JSON body for POST/PUT/PATCH.
 * Body sources compose in order: --data (raw JSON) → --input @file / stdin → -F fields.
 * If multiple body sources are given, later sources take precedence for overlapping keys.
 */
export default class Api extends BaseCommand {
  static override description =
    'Call any AGLedger API endpoint. Pass-through with zero flag translation — use the exact path and body shape documented in the API (see `agledger discover` or GET /openapi.json).';

  static override examples = [
    'agledger api GET /health',
    'agledger api GET /v1/mandates -F status=ACTIVE -F limit=50',
    'agledger api POST /v1/mandates --data \'{"contractType":"ACH-PROC-v1","criteria":{"item_spec":"..."}}\'',
    'agledger api POST /v1/mandates -F contractType=ACH-PROC-v1 -F criteria.item_spec=widgets -F criteria.quantity.target=500',
    'agledger api POST /v1/mandates --input payload.json',
    'cat payload.json | agledger api POST /v1/mandates --input -',
    'agledger api GET /v1/mandates --paginate  # streams all pages as NDJSON',
  ];

  static override args = {
    method: Args.string({
      description: 'HTTP method (GET, POST, PUT, PATCH, DELETE)',
      required: true,
    }),
    path: Args.string({
      description: 'Full API path including version prefix (e.g. /v1/mandates, /health, /federation/v1/register)',
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    data: Flags.string({
      description: 'Request body as a JSON string. For GET/DELETE, used as query parameters.',
    }),
    input: Flags.string({
      description: 'Read body JSON from file (or "-" for stdin). Shape matches --data.',
    }),
    field: Flags.string({
      char: 'F',
      multiple: true,
      description:
        'Set a field as key=value. Values are typed: true/false/null, numbers, or JSON for {...}/[...]. Supports nested (a.b.c=v) and array append (arr[]=v). Repeatable.',
    }),
    query: Flags.string({
      description: 'Extra query parameters as JSON. Merges over -F fields and --data for GET/DELETE routing.',
    }),
    paginate: Flags.boolean({
      description: 'Follow cursor pagination, stream all results as NDJSON. Requires GET on a paginated route.',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show the request that would be sent without calling the API.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Api);
    try {
      const method = args.method.toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        this.failWith(
          ErrorCode.INVALID_METHOD,
          `Unsupported HTTP method: ${args.method}`,
          ExitCode.USAGE_ERROR,
          `Use one of: ${[...ALLOWED_METHODS].join(', ')}.`,
        );
      }

      if (!args.path.startsWith('/')) {
        this.failWith(
          ErrorCode.INVALID_PATH,
          `Path must start with '/': got '${args.path}'`,
          ExitCode.USAGE_ERROR,
          'Use the full path including version prefix, e.g. /v1/mandates or /health. Run `agledger discover` for the workflow.',
        );
      }

      const params = this.composeParams(flags);

      if (flags.paginate) {
        if (method !== 'GET') {
          this.failWith(
            ErrorCode.INVALID_METHOD,
            '--paginate only works with GET requests',
            ExitCode.USAGE_ERROR,
          );
        }
        await this.runPaginated(flags, args.path, params, flags['dry-run']);
        return;
      }

      const options: { query?: Record<string, unknown>; body?: unknown } = {};
      if (params !== undefined) {
        if (method === 'GET' || method === 'DELETE') {
          options.query = params as Record<string, unknown>;
        } else {
          options.body = params;
        }
      }

      if (flags['dry-run']) {
        this.dryRunOutput(
          { method, path: args.path, ...options },
          `would call ${method} ${args.path}`,
        );
        return;
      }

      const response = await this.callApi(flags, method, args.path, options);
      if (!response.ok) {
        this.handleApiError(response);
      }
      this.output(response.body);
    } catch (err) {
      if (err instanceof FieldParseError) {
        this.failWith(
          ErrorCode.INVALID_FIELD,
          `Invalid -F/--field value '${err.field}': ${err.message}`,
          ExitCode.USAGE_ERROR,
          'Use key=value. Supported: string, number, true/false/null, JSON objects/arrays. Nested via a.b=v, arrays via arr[]=v.',
        );
      }
      this.handleError(err);
    }
  }

  /**
   * Merge --data, --input, -F, and --query into a single params object.
   * Precedence (low → high): --data → --input → -F fields → --query.
   * Returns undefined if no source provided.
   */
  private composeParams(flags: {
    data?: string;
    input?: string;
    field?: string[];
    query?: string;
  }): unknown {
    let body: unknown;

    if (flags.data !== undefined) {
      body = this.parseJsonInput(flags.data, '--data');
    }

    if (flags.input !== undefined) {
      const fromFile = this.readJsonSource(flags.input, '--input');
      body = this.mergeIfObject(body, fromFile);
    }

    if (flags.field && flags.field.length > 0) {
      const fromFields = parseFields(flags.field);
      body = this.mergeIfObject(body, fromFields);
    }

    if (flags.query !== undefined) {
      const fromQuery = this.parseJsonInput(flags.query, '--query');
      body = this.mergeIfObject(body, fromQuery);
    }

    return body;
  }

  /** Shallow-merge two objects. Non-objects override entirely. */
  private mergeIfObject(existing: unknown, incoming: unknown): unknown {
    if (
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      incoming !== null &&
      typeof incoming === 'object' &&
      !Array.isArray(incoming)
    ) {
      return { ...(existing as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
    }
    return incoming;
  }

  private async runPaginated(
    flags: { 'api-key'?: string; 'api-url'?: string },
    path: string,
    params: unknown,
    dryRun: boolean,
  ): Promise<void> {
    const baseQuery =
      params && typeof params === 'object' && !Array.isArray(params)
        ? { ...(params as Record<string, unknown>) }
        : {};

    if (dryRun) {
      this.dryRunOutput(
        { method: 'GET', path, query: baseQuery, paginate: true },
        `would stream all pages of GET ${path}`,
      );
      return;
    }

    const query: Record<string, unknown> = { ...baseQuery };
    let cursor: string | undefined;
    let prevCursor: string | undefined;
    do {
      if (cursor) query.cursor = cursor;
      const response = await this.callApi(flags, 'GET', path, { query });
      if (!response.ok) {
        this.handleApiError(response);
      }
      const page = (response.body ?? {}) as Record<string, unknown>;
      const items = (page.data ?? []) as unknown[];
      for (const item of items) {
        this.outputNdjson(item);
      }
      if (page.hasMore === false || items.length === 0) break;
      const nextCursor = (page.nextCursor ?? page.cursor) as string | undefined;
      if (!nextCursor || nextCursor === prevCursor || nextCursor === cursor) break;
      prevCursor = cursor;
      cursor = nextCursor;
    } while (cursor);
  }
}
