/**
 * AGLedger CLI: base command with dual-mode output, auth, and error forwarding.
 * The CLI is a thin pass-through over the API; this base exists to make that
 * pass-through consistent (same exit codes, same error shape, same output modes).
 *
 * NO_COLOR (no-color.org): the CLI emits plain JSON to both stdout (results)
 * and stderr (errors) with no ANSI escapes of its own, so it is trivially
 * NO_COLOR-conformant by construction. oclif's own help/error rendering also
 * honors NO_COLOR via chalk's built-in detection, so no explicit check needed.
 */

import { readFileSync } from 'node:fs';
import { Command, Flags } from '@oclif/core';
import { ApiClient } from './api-client.js';
import type { ApiResponse } from './api-client.js';
import { readConfig } from './util/config.js';

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
  /** Required configuration (currently the API URL) is absent. Exits as a
   *  usage error rather than claiming a new exit code. */
  CONFIG_ERROR: 'CONFIG_ERROR',
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

/**
 * Discovery surfaces the Server answers without an Authorization header. A
 * keyless `agledger api GET /health` was refused client-side before any request
 * was made, so an agent holding only a URL had to shell out to curl for exactly
 * the bootstrap arc the product optimizes for.
 *
 * Read-only by construction: only GET qualifies, so this can never wave through
 * a write. Anything not listed still requires a key, and the Server remains the
 * authority: a path that starts requiring auth simply answers 401.
 */
const PUBLIC_GET_PATHS = new Set([
  '/health',
  '/llms.txt',
  '/llms-full.txt',
  '/openapi.json',
  '/docs',
  '/v1/conformance',
]);

function isPublicPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const bare = (path.split('?')[0] ?? path).replace(/\/+$/, '') || '/';
  return PUBLIC_GET_PATHS.has(bare) || bare.startsWith('/.well-known/');
}

export abstract class BaseCommand extends Command {
  /** The URL the most recent client was built for, so a network failure can
   *  name the host it actually tried. */
  private lastApiUrl?: string;

  static baseFlags = {
    json: Flags.boolean({ description: 'Force JSON output (default when stdout is piped)', default: false }),
    quiet: Flags.boolean({ description: 'Suppress output (exit code only)', default: false }),
    'api-key': Flags.string({ description: 'AGLedger API key', env: 'AGLEDGER_API_KEY' }),
    'api-url': Flags.string({ description: 'AGLedger API base URL', env: 'AGLEDGER_API_URL' }),
    profile: Flags.string({
      description: 'Stored profile to use for credentials (falls back to the active profile)',
    }),
  };

  protected get isJson(): boolean {
    return process.argv.includes('--json') || !process.stdout.isTTY;
  }

  protected get isQuiet(): boolean {
    return process.argv.includes('--quiet');
  }

  /**
   * Resolve credentials and build the API client.
   *
   * Precedence:
   *   API key: `--api-key` flag > `AGLEDGER_API_KEY` env > stored profile.
   *   API URL: `--api-url` flag > `AGLEDGER_API_URL` env > stored profile url.
   *            There is no default; AGLedger is self-hosted.
   *
   * oclif merges the flag and its `env` source into `flags['api-key']` /
   * `flags['api-url']`, so a present value there already represents flag-or-env
   * (both of which outrank the profile). When absent, fall back to the selected
   * profile (`--profile <name>`, else the active profile) in ~/.agledger/config.json.
   */
  protected createApiClient(
    flags: { 'api-key'?: string; 'api-url'?: string; profile?: string },
    options?: { allowAnonymous?: boolean },
  ): ApiClient {
    const config = readConfig();
    const profileName = flags.profile ?? config.activeProfile;
    const profile = profileName ? config.profiles[profileName] : undefined;

    // Treat an empty-string flag/env (e.g. AGLEDGER_API_KEY="") as absent so the
    // profile fallback still applies.
    const flagKey = flags['api-key'] || undefined;
    const flagUrl = flags['api-url'] || undefined;

    // A profile is only consulted when the flag/env didn't supply the key. If the
    // caller explicitly named a missing profile AND has no flag/env key to fall
    // back on, that's an error worth surfacing (rather than a generic no-key one).
    if (flags.profile && !profile && !flagKey) {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        `Profile '${flags.profile}' not found.`,
        ExitCode.AUTH_ERROR,
        'Run `agledger config list` to see profiles, or `agledger login --profile <name>` to create one.',
      );
    }

    const apiKey = flagKey ?? profile?.apiKey ?? null;
    // Discovery surfaces answer without auth, so a keyless invocation proceeds
    // anonymously rather than being refused before any request is made. The
    // Server, not the CLI, decides what needs a key.
    if (!apiKey && !options?.allowAnonymous) {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        'No API key. Set AGLEDGER_API_KEY, use --api-key, or run `agledger login`.',
        ExitCode.AUTH_ERROR,
      );
    }

    // No placeholder: a default of agledger.example.com resolved nowhere and
    // turned a missing config into a DNS failure the user could not read.
    // Every deployment is self-hosted, so there is no sane default.
    const apiUrl = flagUrl ?? profile?.apiUrl;
    if (!apiUrl) {
      this.failWith(
        ErrorCode.CONFIG_ERROR,
        'No API URL configured. AGLedger is self-hosted, so there is no default server to call.',
        ExitCode.USAGE_ERROR,
        'Pass --api-url <url>, set AGLEDGER_API_URL, or run `agledger login --api-url <url> --api-key <key>`.',
      );
    }

    this.lastApiUrl = apiUrl;
    return new ApiClient(apiUrl, apiKey, this.config.version);
  }

  /**
   * Resolve the credentials that an actual call would use, for --dry-run display.
   * Same precedence as `createApiClient` (flag > env > profile), but the key is
   * masked so it is safe to print. Returns the resolved api URL and which source
   * the key came from. Does not throw on a missing key (dry-run is non-fatal).
   */
  protected resolvedAuth(flags: { 'api-key'?: string; 'api-url'?: string; profile?: string }): {
    apiUrl: string | null;
    apiUrlSource?: string;
    apiKey: string | null;
    source: 'flag-or-env' | 'profile' | 'none';
    profile?: string;
  } {
    const config = readConfig();
    const profileName = flags.profile ?? config.activeProfile;
    const profile = profileName ? config.profiles[profileName] : undefined;

    const flagKey = flags['api-key'] || undefined;
    const flagUrl = flags['api-url'] || undefined;
    const apiKey = flagKey ?? profile?.apiKey ?? null;
    const source = flagKey ? 'flag-or-env' : profile?.apiKey ? 'profile' : 'none';
    // Null, not a placeholder. `agledger.example.com` was removed from
    // `createApiClient`, which now refuses to build a client without a URL, but
    // this sibling kept it. The whole job of --dry-run is to report what the
    // real call would do, and it was reporting a host the real call refuses to
    // use: the unconfigured case printed agledger.example.com and exited 0
    // while the same invocation without --dry-run exited 2 with CONFIG_ERROR.
    const apiUrl = flagUrl ?? profile?.apiUrl ?? null;

    const mask = (k: string): string => (k.length <= 4 ? '****' : `****${k.slice(-4)}`);
    return {
      apiUrl,
      apiKey: apiKey ? mask(apiKey) : null,
      source,
      // A dry run whose real counterpart would refuse to send says so, rather
      // than leaving a bare `"apiUrl": null` for the reader to interpret.
      ...(apiUrl === null
        ? {
            apiUrlSource:
              'unconfigured: this call would fail with CONFIG_ERROR (exit 2). Pass --api-url <url>, set AGLEDGER_API_URL, or run `agledger login --api-url <url> --api-key <key>`.',
          }
        : {}),
      ...(source === 'profile' && profileName ? { profile: profileName } : {}),
    };
  }

  /**
   * Call the API. Path is passed through as-is; caller provides the full path
   * (e.g. `/v1/records`, `/health`, `/federation/v1/peer`). No auto-prefixing.
   */
  protected async callApi(
    flags: { 'api-key'?: string; 'api-url'?: string; profile?: string },
    method: string,
    path: string,
    options?: { query?: Record<string, unknown>; body?: unknown; idempotencyKey?: string },
  ): Promise<ApiResponse> {
    const client = this.createApiClient(flags, { allowAnonymous: isPublicPath(method, path) });
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
      process.stderr.write(`Dry run: ${label}:\n`);
    }
    this.output(payload);
  }

  /**
   * Parse JSON with structured error on failure. Use for any user-supplied JSON input.
   *
   * `suggestion` is overridable because the default names `--data` and
   * `--input`, which only the `api` command has. `verify` was handing users
   * recovery advice for flags it does not accept.
   */
  protected parseJsonInput(source: string, fieldName: string, suggestion?: string): unknown {
    try {
      return JSON.parse(source);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('EEXIT:')) throw err;
      this.failWith(
        ErrorCode.INVALID_JSON_INPUT,
        `${fieldName} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ExitCode.USAGE_ERROR,
        suggestion ??
          'Check that the JSON is properly quoted. For complex payloads, use --input <file> instead of --data.',
      );
      throw new Error('unreachable');
    }
  }

  /** Read and parse a JSON file with structured errors. `-` reads from stdin. */
  protected readJsonSource(path: string, fieldName: string, suggestion?: string): unknown {
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
        // Same reason the parse suggestion is overridable: the default names
        // --input, which only the `api` command has.
        suggestion ?? 'Check that the path exists and is readable, or pipe JSON to stdin with --input -.',
      );
      throw new Error('unreachable');
    }
    return this.parseJsonInput(content, path === '-' ? 'stdin' : `${fieldName} ${path}`, suggestion);
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
      // "fetch failed" is undici's generic message: DNS failure, connection
      // refused and TLS problems all print identically. Name the host that was
      // tried and the underlying cause, or the user has nothing to debug from.
      const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
      const causeCode = typeof cause?.code === 'string' ? cause.code : undefined;
      const causeMessage = typeof cause?.message === 'string' ? cause.message : undefined;
      const target = this.lastApiUrl ? ` connecting to ${this.lastApiUrl}` : '';
      const detail = causeCode ?? causeMessage;
      this.failWith(
        ErrorCode.NETWORK_ERROR,
        `${String(err.message)}${target}${detail ? ` (${detail})` : ''}`,
        ExitCode.NETWORK_ERROR,
        causeCode === 'ENOTFOUND'
          ? 'The host does not resolve. Check the API URL for a typo, and that DNS can see it from here.'
          : causeCode === 'ECONNREFUSED'
            ? 'The host resolved but refused the connection. Check the Server is running and the port is right.'
            : 'Check the API URL and that the Server is reachable from here.',
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
