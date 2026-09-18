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
import { OIDC_ENV, OidcCertCredential, OidcExchangeError, OidcTokenSourceError, type OidcTokenSource } from './oidc.js';
import { readConfig, type Profile } from './util/config.js';

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
  /** The OIDC token command or file could not produce a token. */
  OIDC_TOKEN_SOURCE_FAILED: 'OIDC_TOKEN_SOURCE_FAILED',
  /** The Server refused `POST /v1/auth/oidc/cert`; its error body rides along as `apiError`. */
  OIDC_EXCHANGE_FAILED: 'OIDC_EXCHANGE_FAILED',
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

/** The credential sources, in the order they are tried, for a no-credential error. */
const CREDENTIAL_SOURCES =
  'Set AGLEDGER_API_KEY (or pass --api-key), set AGLEDGER_OIDC_TOKEN_CMD to a command that prints an OIDC token, set AGLEDGER_OIDC_TOKEN_FILE to a file holding one, or run `agledger login`.';

type AuthFlags = { 'api-key'?: string; 'api-url'?: string; profile?: string; verbose?: boolean };

/** Where a command's credential comes from. Never holds a cert or a private key. */
export type ResolvedCredential =
  | { kind: 'api-key'; key: string; from: 'flag-or-env' | 'profile'; origin: string }
  | { kind: 'oidc'; source: OidcTokenSource; agentId?: string; from: 'env' | 'profile' }
  | { kind: 'none' };

/** The OIDC token source stored on a profile, if it has one. */
export function profileOidcSource(name: string, profile: Profile | undefined): OidcTokenSource | undefined {
  const oidc = profile?.oidc;
  if (oidc?.tokenCommand) {
    return { kind: 'command', command: oidc.tokenCommand, origin: `profile '${name}' oidc.tokenCommand` };
  }
  if (oidc?.tokenFile) {
    return { kind: 'file', path: oidc.tokenFile, origin: `profile '${name}' oidc.tokenFile` };
  }
  return undefined;
}

/** The OIDC token source named by the environment: the command outranks the file. */
export function envOidcSource(): OidcTokenSource | undefined {
  const command = process.env[OIDC_ENV.TOKEN_CMD];
  if (command) return { kind: 'command', command, origin: OIDC_ENV.TOKEN_CMD };
  const path = process.env[OIDC_ENV.TOKEN_FILE];
  if (path) return { kind: 'file', path, origin: OIDC_ENV.TOKEN_FILE };
  return undefined;
}

/** Whether a flag was passed on the command line (`--flag value` or `--flag=value`),
 *  as opposed to reaching oclif through its `env` binding. */
export function argvHasFlag(flag: string): boolean {
  return process.argv.some((a) => a === flag || a.startsWith(`${flag}=`));
}

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
    verbose: Flags.boolean({
      description:
        'Report which credential was used, and each OIDC cert exchange, as JSON lines on stderr. Never prints a key, token or cert.',
      default: false,
    }),
  };

  protected get isJson(): boolean {
    return process.argv.includes('--json') || !process.stdout.isTTY;
  }

  protected get isQuiet(): boolean {
    return process.argv.includes('--quiet');
  }

  /** Write one diagnostic line to stderr under --verbose. Callers pass no secrets. */
  protected verboseLog(flags: { verbose?: boolean }, event: Record<string, unknown>): void {
    if (flags.verbose) process.stderr.write(JSON.stringify({ verbose: true, ...event }) + '\n');
  }

  /**
   * Resolve which credential a command uses, without calling anything.
   *
   * Precedence, highest first:
   *   1. An API key from `--api-key` or `AGLEDGER_API_KEY` (oclif merges the
   *      two into `flags['api-key']`).
   *   2. `AGLEDGER_OIDC_TOKEN_CMD`, then `AGLEDGER_OIDC_TOKEN_FILE`.
   *   3. The selected profile (`--profile <name>`, else the active one): its
   *      API key, or the OIDC token source `agledger login --oidc` stored.
   *
   * Explicit per-invocation sources outrank stored ones, which is the rule the
   * API key already followed. `AGLEDGER_OIDC_AGENT_ID` overrides a profile's
   * stored agent id.
   */
  protected resolveCredential(flags: AuthFlags): { credential: ResolvedCredential; profileName?: string; profile?: Profile } {
    const config = readConfig();
    const profileName = flags.profile ?? config.activeProfile;
    const profile = profileName ? config.profiles[profileName] : undefined;
    const envAgentId = process.env[OIDC_ENV.AGENT_ID] || undefined;

    // Treat an empty-string flag/env (e.g. AGLEDGER_API_KEY="") as absent so the
    // later sources still apply.
    const flagKey = flags['api-key'] || undefined;
    if (flagKey) {
      const origin = argvHasFlag('--api-key') ? '--api-key' : 'AGLEDGER_API_KEY';
      return { credential: { kind: 'api-key', key: flagKey, from: 'flag-or-env', origin }, profileName, profile };
    }
    const fromEnv = envOidcSource();
    if (fromEnv) {
      return {
        credential: { kind: 'oidc', source: fromEnv, ...(envAgentId ? { agentId: envAgentId } : {}), from: 'env' },
        profileName,
        profile,
      };
    }
    if (profileName && profile?.apiKey) {
      return {
        credential: { kind: 'api-key', key: profile.apiKey, from: 'profile', origin: `profile '${profileName}'` },
        profileName,
        profile,
      };
    }
    const fromProfile = profileName ? profileOidcSource(profileName, profile) : undefined;
    if (fromProfile) {
      const agentId = envAgentId ?? profile?.oidc?.agentId;
      return {
        credential: { kind: 'oidc', source: fromProfile, ...(agentId ? { agentId } : {}), from: 'profile' },
        profileName,
        profile,
      };
    }
    return { credential: { kind: 'none' }, profileName, profile };
  }

  /**
   * Resolve credentials and build the API client.
   *
   * Credential precedence is `resolveCredential`'s. API URL: `--api-url` flag >
   * `AGLEDGER_API_URL` env > stored profile url. There is no default;
   * AGLedger is self-hosted.
   */
  protected createApiClient(flags: AuthFlags, options?: { allowAnonymous?: boolean }): ApiClient {
    const { credential, profile } = this.resolveCredential(flags);
    const flagUrl = flags['api-url'] || undefined;

    // A profile is only consulted when nothing more explicit supplied a
    // credential. If the caller explicitly named a missing profile AND has
    // nothing else to fall back on, that's an error worth surfacing (rather
    // than a generic no-credential one).
    if (flags.profile && !profile && credential.kind === 'none') {
      this.failWith(
        ErrorCode.AUTH_REQUIRED,
        `Profile '${flags.profile}' not found.`,
        ExitCode.AUTH_ERROR,
        'Run `agledger config list` to see profiles, or `agledger login --profile <name>` to create one.',
      );
    }

    // Discovery surfaces answer without auth, so a credential-less invocation
    // proceeds anonymously rather than being refused before any request is
    // made. The Server, not the CLI, decides what needs a key.
    if (credential.kind === 'none' && !options?.allowAnonymous) {
      this.failWith(ErrorCode.AUTH_REQUIRED, 'No credential configured.', ExitCode.AUTH_ERROR, CREDENTIAL_SOURCES);
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
    this.verboseLog(flags, { event: 'auth', ...this.describeCredential(credential), apiUrl });

    if (credential.kind === 'oidc') {
      return new ApiClient(apiUrl, this.oidcCredential(flags, credential), this.config.version);
    }
    return new ApiClient(apiUrl, credential.kind === 'api-key' ? credential.key : null, this.config.version);
  }

  /** Build a cert credential for one invocation. Its key pair never leaves memory. */
  protected oidcCredential(
    flags: { verbose?: boolean },
    credential: { source: OidcTokenSource; agentId?: string },
  ): OidcCertCredential {
    return new OidcCertCredential({
      source: credential.source,
      ...(credential.agentId ? { agentId: credential.agentId } : {}),
      userAgent: `agledger-cli/${this.config.version}`,
      log: (event) => this.verboseLog(flags, event),
    });
  }

  /** A secret-free description of a credential, for --verbose, --dry-run and `auth`. */
  protected describeCredential(credential: ResolvedCredential): Record<string, unknown> {
    switch (credential.kind) {
      case 'api-key':
        return { credential: 'api-key', source: credential.origin };
      case 'oidc':
        return {
          credential: 'oidc-cert',
          source: credential.source.origin,
          ...(credential.source.kind === 'file' ? { tokenFile: credential.source.path } : {}),
          ...(credential.agentId ? { agentId: credential.agentId } : {}),
        };
      case 'none':
        return { credential: 'none' };
    }
  }

  /**
   * Resolve the credentials that an actual call would use, for --dry-run display.
   * Same precedence as `createApiClient`, but the key is masked so it is safe
   * to print, and an OIDC token source is named, never run. Does not throw on
   * a missing credential (dry-run is non-fatal).
   */
  protected resolvedAuth(flags: AuthFlags): {
    apiUrl: string | null;
    apiUrlSource?: string;
    apiKey: string | null;
    source: 'flag-or-env' | 'env' | 'profile' | 'none';
    credential: 'api-key' | 'oidc-cert' | 'none';
    oidcTokenSource?: string;
    profile?: string;
  } {
    const { credential, profileName, profile } = this.resolveCredential(flags);
    const flagUrl = flags['api-url'] || undefined;
    // Null, not a placeholder. `agledger.example.com` was removed from
    // `createApiClient`, which now refuses to build a client without a URL, but
    // this sibling kept it. The whole job of --dry-run is to report what the
    // real call would do, and it was reporting a host the real call refuses to
    // use: the unconfigured case printed agledger.example.com and exited 0
    // while the same invocation without --dry-run exited 2 with CONFIG_ERROR.
    const apiUrl = flagUrl ?? profile?.apiUrl ?? null;

    const mask = (k: string): string => (k.length <= 4 ? '****' : `****${k.slice(-4)}`);
    const source = credential.kind === 'none' ? 'none' : credential.from;
    return {
      apiUrl,
      apiKey: credential.kind === 'api-key' ? mask(credential.key) : null,
      source,
      credential: credential.kind === 'oidc' ? 'oidc-cert' : credential.kind,
      ...(credential.kind === 'oidc' ? { oidcTokenSource: credential.source.origin } : {}),
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
    flags: AuthFlags,
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
    if (err instanceof OidcTokenSourceError) {
      this.failWith(
        ErrorCode.OIDC_TOKEN_SOURCE_FAILED,
        err.message,
        ExitCode.AUTH_ERROR,
        err.kind === 'command'
          ? `Run the command in ${err.origin} by hand and check it prints one OIDC JWT on stdout and exits 0.`
          : `Check the file named by ${err.origin} exists, is readable, and holds one OIDC JWT.`,
      );
    }
    if (err instanceof OidcExchangeError) {
      // The Server's error body is forwarded as it came (its recoveryHint is
      // the useful part), with the OIDC token scrubbed out of it.
      const error = {
        error: true,
        code: ErrorCode.OIDC_EXCHANGE_FAILED,
        message: err.message,
        status: err.status,
        source: err.origin,
        apiError: err.body,
      };
      process.stderr.write(JSON.stringify(error) + '\n');
      this.exit(this.statusToExitCode(err.status));
      throw new Error('unreachable');
    }
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
