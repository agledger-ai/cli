/**
 * AGLedger CLI — Base command with dual-mode output, auth, and error forwarding.
 * The CLI is a thin pass-through over the API — this base exists to make that
 * pass-through consistent (same exit codes, same error shape, same output modes).
 */

import { readFileSync } from 'node:fs';
import { Command, Flags } from '@oclif/core';
import { ApiClient } from './api-client.js';
import type { ApiResponse } from './api-client.js';

/** Semantic exit codes for agent consumption. Stable across releases. */
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

/**
 * Canonical CLI-origin error codes emitted in the `code` field of structured errors.
 * Used only when the CLI itself can't forward an API error (no auth, bad JSON input,
 * network failure). API-origin codes come through untouched from the API response body.
 */
export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  MISSING_INPUT: 'MISSING_INPUT',
  INVALID_JSON_INPUT: 'INVALID_JSON_INPUT',
  INVALID_PATH: 'INVALID_PATH',
  INVALID_METHOD: 'INVALID_METHOD',
  INVALID_FIELD: 'INVALID_FIELD',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export abstract class BaseCommand extends Command {
  static baseFlags = {
    json: Flags.boolean({ description: 'Force JSON output (default when stdout is piped)', default: false }),
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
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        'No API key. Set AGLEDGER_API_KEY, use --api-key, or run `agledger login`.',
        ExitCode.AUTH_ERROR,
      );
    }
    return new ApiClient(flags['api-url'] || 'https://agledger.example.com', apiKey!);
  }

  /**
   * Call the API. Path is passed through as-is — caller provides the full path
   * (e.g. `/v1/mandates`, `/health`, `/federation/v1/register`). No auto-prefixing.
   */
  protected async callApi(
    flags: { 'api-key'?: string; 'api-url'?: string },
    method: string,
    path: string,
    options?: { query?: Record<string, unknown>; body?: unknown },
  ): Promise<ApiResponse> {
    const client = this.createApiClient(flags);
    return client.request(method, path, options);
  }

  protected output(data: unknown): void {
    if (this.isQuiet) return;
    if (this.isJson) {
      process.stdout.write(JSON.stringify(data) + '\n');
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    }
  }

  protected outputNdjson(item: unknown): void {
    if (this.isQuiet) return;
    process.stdout.write(JSON.stringify(item) + '\n');
  }

  /**
   * Show a dry-run payload. Suppressed under --quiet. Writes header to stderr, payload to stdout.
   * `label` describes the action concretely so agents can log what would have happened.
   */
  protected dryRunOutput(payload: unknown, label: string): void {
    if (this.isQuiet) return;
    if (!this.isJson) {
      process.stderr.write(`Dry run — ${label}:\n`);
    }
    this.output(payload);
  }

  /** Parse JSON with structured error on failure. Use for any user-supplied JSON input. */
  protected parseJsonInput(source: string, fieldName: string): unknown {
    try {
      return JSON.parse(source);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('EEXIT:')) throw err;
      this.failWith(
        ErrorCode.INVALID_JSON_INPUT,
        `${fieldName} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ExitCode.USAGE_ERROR,
        'Check that the JSON is properly quoted. For complex payloads, use --input <file> instead of --data.',
      );
      throw new Error('unreachable');
    }
  }

  /** Read and parse a JSON file with structured errors. `-` reads from stdin. */
  protected readJsonSource(path: string, fieldName: string): unknown {
    let content: string;
    try {
      if (path === '-') {
        content = readFileSync(0, 'utf-8');
      } else {
        content = readFileSync(path, 'utf-8');
      }
    } catch (err) {
      this.failWith(
        ErrorCode.FILE_READ_ERROR,
        `Cannot read ${fieldName} at ${path === '-' ? 'stdin' : path}: ${err instanceof Error ? err.message : String(err)}`,
        ExitCode.USAGE_ERROR,
        'Check that the path exists and is readable, or pipe JSON to stdin with --input -.',
      );
      throw new Error('unreachable');
    }
    return this.parseJsonInput(content, path === '-' ? 'stdin' : `${fieldName} ${path}`);
  }

  protected failWith(code: string, message: string, exitCode: number, suggestion?: string): never {
    const error: Record<string, unknown> = { error: true, code, message };
    if (suggestion) error.suggestion = suggestion;
    process.stderr.write(JSON.stringify(error) + '\n');
    this.exit(exitCode);
    throw new Error('unreachable');
  }

  /**
   * Forward the full API error body to stderr verbatim. The API owns error
   * guidance (code, message, suggestion, validationErrors, nextSteps); the CLI
   * does not enrich, translate, or inject fields the API didn't return.
   */
  protected handleApiError(response: ApiResponse): never {
    const body = (response.body ?? {}) as Record<string, unknown>;
    const exitCode = this.statusToExitCode(response.status);
    const error: Record<string, unknown> = { error: true, ...body };
    process.stderr.write(JSON.stringify(error) + '\n');
    this.exit(exitCode);
    throw new Error('unreachable');
  }

  protected handleError(err: unknown): never {
    if (err instanceof Error && err.message.startsWith('EEXIT:')) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      this.failWith(
        ErrorCode.TIMEOUT,
        'Request timed out.',
        ExitCode.TIMEOUT,
        'Retry the same command. If it persists, run `agledger discover` to check API connectivity.',
      );
    }
    if (err instanceof TypeError && String(err.message).includes('fetch')) {
      this.failWith(
        ErrorCode.NETWORK_ERROR,
        String(err.message),
        ExitCode.NETWORK_ERROR,
        'Check that AGLEDGER_API_URL is correct. Run `agledger discover` to verify connectivity.',
      );
    }
    this.failWith(
      ErrorCode.UNKNOWN_ERROR,
      err instanceof Error ? err.message : String(err),
      ExitCode.GENERAL_ERROR,
      'Run `agledger api --help` to see usage.',
    );
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
