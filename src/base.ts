/**
 * AGLedger CLI — Base command with dual-mode output and auth.
 * All commands extend this for consistent behavior.
 */

import { Command, Flags } from '@oclif/core';
import { ApiClient } from './api-client.js';
import type { ApiResponse } from './api-client.js';

/** Semantic exit codes for agent consumption. */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  AUTH_ERROR: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  RATE_LIMITED: 7,
  SERVER_ERROR: 8,
  NETWORK_ERROR: 9,
  TIMEOUT: 10,
} as const;

export abstract class BaseCommand extends Command {
  static baseFlags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
    quiet: Flags.boolean({ description: 'Suppress output (exit code only)', default: false }),
    'api-key': Flags.string({ description: 'AGLedger API key', env: 'AGLEDGER_API_KEY' }),
    'api-url': Flags.string({ description: 'AGLedger API base URL', env: 'AGLEDGER_API_URL' }),
  };

  protected get isJson(): boolean {
    return process.argv.includes('--json') || !process.stdout.isTTY;
  }

  protected get isQuiet(): boolean {
    return process.argv.includes('--quiet');
  }

  protected createApiClient(flags: { 'api-key'?: string; 'api-url'?: string }): ApiClient {
    const apiKey = flags['api-key'];
    if (!apiKey) {
      this.failWith('AUTH_REQUIRED', 'No API key. Set AGLEDGER_API_KEY, use --api-key, or run `agledger login`.', ExitCode.AUTH_ERROR);
    }
    return new ApiClient(flags['api-url'] || 'https://agledger.example.com', apiKey!);
  }

  /** API call — passes through the full response body unchanged on success and error. */
  protected async api(
    flags: { 'api-key'?: string; 'api-url'?: string },
    method: string,
    path: string,
    options?: { query?: Record<string, unknown>; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const client = this.createApiClient(flags);
    // API routes are mounted under /v1 except /health and /federation/v1/*
    const fullPath = path.startsWith('/health') || path.startsWith('/federation/') ? path : `/v1${path}`;
    const response = await client.request(method, fullPath, options);
    if (!response.ok) {
      this.handleApiError(response);
    }
    return response.body as Record<string, unknown>;
  }

  protected output(data: Record<string, unknown>): void {
    if (this.isQuiet) return;
    if (this.isJson) {
      process.stdout.write(JSON.stringify(data) + '\n');
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    }
  }

  protected outputPage(page: { data: unknown[]; hasMore?: boolean; cursor?: string }, columns: string[]): void {
    if (this.isQuiet) return;
    if (this.isJson) {
      process.stdout.write(JSON.stringify(page) + '\n');
    } else {
      if (page.data.length === 0) {
        process.stderr.write('No results.\n');
        return;
      }
      const rows = page.data as Record<string, unknown>[];
      const header = columns.join('\t');
      process.stdout.write(header + '\n');
      process.stdout.write(columns.map(() => '---').join('\t') + '\n');
      for (const row of rows) {
        process.stdout.write(columns.map((c) => String(row[c] ?? '')).join('\t') + '\n');
      }
      if (page.hasMore) {
        process.stderr.write(`\n(more results available — use --all to stream all pages)\n`);
      }
    }
  }

  protected outputNdjson(item: unknown): void {
    if (this.isQuiet) return;
    process.stdout.write(JSON.stringify(item) + '\n');
  }

  /** Stream all pages as NDJSON, or return a single page for outputPage(). */
  protected async paginate(
    flags: { 'api-key'?: string; 'api-url'?: string },
    path: string,
    query: Record<string, unknown>,
    opts: { all: boolean; columns: string[] },
  ): Promise<void> {
    if (opts.all) {
      let cursor: string | undefined;
      let prevCursor: string | undefined;
      do {
        if (cursor) query.cursor = cursor;
        const page = await this.api(flags, 'GET', path, { query });
        const items = (page.data ?? []) as unknown[];
        for (const item of items) {
          this.outputNdjson(item);
        }
        if (page.hasMore === false || items.length === 0) break;
        const nextCursor = (page.nextCursor ?? page.cursor) as string | undefined;
        if (nextCursor === prevCursor || nextCursor === cursor) break; // stale cursor guard
        prevCursor = cursor;
        cursor = nextCursor;
      } while (cursor);
    } else {
      const page = await this.api(flags, 'GET', path, { query });
      this.outputPage(page as { data: unknown[] }, opts.columns);
    }
  }

  protected failWith(code: string, message: string, exitCode: number, suggestion?: string): never {
    const error: Record<string, unknown> = { error: true, code, message };
    if (suggestion) error.suggestion = suggestion;
    process.stderr.write(JSON.stringify(error) + '\n');
    this.exit(exitCode);
    throw new Error('unreachable');
  }

  /** Forward the full API error body to stderr — enriches with recovery suggestion if missing. */
  protected handleApiError(response: ApiResponse): never {
    const body = (response.body ?? {}) as Record<string, unknown>;
    const exitCode = this.statusToExitCode(response.status);
    if (!body.suggestion) {
      body.suggestion = this.recoveryHint(response.status);
    }
    const error: Record<string, unknown> = { error: true, ...body };
    process.stderr.write(JSON.stringify(error) + '\n');
    this.exit(exitCode);
    throw new Error('unreachable');
  }

  protected handleError(err: unknown): never {
    // Re-throw oclif exit errors — already handled by handleApiError/failWith
    if (err instanceof Error && err.message.startsWith('EEXIT:')) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      this.failWith('TIMEOUT', 'Request timed out.', ExitCode.TIMEOUT,
        'Retry the same command. If it persists, run "agledger status" to check API connectivity.');
    }
    if (err instanceof TypeError && String(err.message).includes('fetch')) {
      this.failWith('NETWORK_ERROR', String(err.message), ExitCode.NETWORK_ERROR,
        'Check that AGLEDGER_API_URL is correct. Run "agledger status" to verify connectivity.');
    }
    this.failWith('UNKNOWN_ERROR', err instanceof Error ? err.message : String(err), ExitCode.GENERAL_ERROR,
      'Run "agledger list-commands" to see available commands.');
  }

  private recoveryHint(status: number): string {
    if (status === 400) return 'Check required fields. Run "agledger schema list" to see valid contract types, or "agledger schema get <type>" for the exact schema.';
    if (status === 401) return 'API key is invalid or expired. Set AGLEDGER_API_KEY or use --api-key.';
    if (status === 403) return 'Your API key lacks the required scope. Check the missingScopes field above.';
    if (status === 404) return 'Resource not found. Run "agledger list-commands" to verify the command, or check the resource ID.';
    if (status === 409) return 'Conflict — the resource state does not allow this action. Run "agledger mandate get <id>" to check current status.';
    if (status === 422) return 'Validation failed. Check the validationErrors field above. Run "agledger schema get <type>" for the expected format.';
    if (status === 429) return 'Rate limited. Wait a moment, then retry the same command.';
    if (status >= 500) return 'Server error. Retry the same command. If it persists, run "agledger status" to check API health.';
    return 'Run "agledger list-commands" to see available commands.';
  }

  private statusToExitCode(status: number): number {
    if (status === 401) return ExitCode.AUTH_ERROR;
    if (status === 403) return ExitCode.FORBIDDEN;
    if (status === 404) return ExitCode.NOT_FOUND;
    if (status === 409) return ExitCode.CONFLICT;
    if (status === 429) return ExitCode.RATE_LIMITED;
    if (status >= 500) return ExitCode.SERVER_ERROR;
    return ExitCode.GENERAL_ERROR;
  }
}
