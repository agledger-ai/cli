/**
 * AGLedger CLI: thin-cover integration tests.
 *
 * The CLI is a pass-through over the API. These tests validate:
 *  - Surface: list-commands + help-json report the 10 CLI-local commands
 *  - `agledger api`: method/path validation, --data/--input/-F/--query merging,
 *    --dry-run, --paginate, auth enforcement, error passthrough
 *  - `discover`, `login`, `auth`, `logout`, `config`: CLI-local behaviors
 *  - Exit codes, --quiet, --json, NO_COLOR
 *
 * No real API calls: all paths that would hit the network either dry-run or
 * fail early on missing auth.
 */

import { describe, it, expect } from 'vitest';
import { execFile, execSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { flagWording } from '../src/commands/verify.js';

const BIN = resolve(import.meta.dirname, '../bin/run.js');

/**
 * A spawn's own deadline. Each one boots node and oclif, which under a loaded
 * machine (a parallel suite, CI) can take well over 10s; a kill at that point
 * reads as exit 1 with empty output, a failure that is not the CLI's.
 */
const SPAWN_TIMEOUT = 60_000;

/** Run a CLI command, capturing stdout/stderr and exit code. */
const run = (args: string, env?: Record<string, string>) => {
  try {
    return {
      stdout: execSync(`node ${BIN} ${args}`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          AGLEDGER_API_KEY: '',
          AGLEDGER_API_URL: '',
          AGLEDGER_OIDC_TOKEN_CMD: '',
          AGLEDGER_OIDC_TOKEN_FILE: '',
          AGLEDGER_OIDC_AGENT_ID: '',
          AGLEDGER_ON_BEHALF_OF_CMD: '',
          AGLEDGER_ON_BEHALF_OF_FILE: '',
          HOME: tmpdir(),
          ...env,
        },
        timeout: SPAWN_TIMEOUT,
      }).trim(),
      stderr: '',
      exitCode: 0,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      exitCode: e.status ?? 1,
    };
  }
};

const parseJson = (result: ReturnType<typeof run>) => {
  const text = result.stdout || result.stderr;
  return JSON.parse(text.split('\n')[0]);
};

const tmpJson = (data: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  const file = join(dir, 'data.json');
  writeFileSync(file, JSON.stringify(data));
  return file;
};

/** Isolate ~/.agledger to a throwaway dir so login/logout/config tests don't touch real config. */
const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'cli-home-'));

// ---------------------------------------------------------------------------
// Discovery: the whole CLI surface
// ---------------------------------------------------------------------------
describe('command surface', () => {
  it('list-commands returns 10 CLI-local commands', () => {
    const result = run('list-commands --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.commands).toBeInstanceOf(Array);
    expect(parsed.commands).toHaveLength(10);
    const names = parsed.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['api', 'discover', 'docs', 'login', 'logout', 'auth', 'config', 'verify', 'list-commands', 'help-json']),
    );
    expect(parsed.note).toContain('agledger api');
  });

  it('list-commands includes no API-backed wrappers', () => {
    const result = run('list-commands --json');
    const names: string[] = JSON.parse(result.stdout).commands.map((c: { name: string }) => c.name);
    for (const removed of ['mandate create', 'receipt submit', 'schema register', 'webhook create', 'verdict render']) {
      expect(names).not.toContain(removed);
    }
  });

  it('help-json returns schema for `api` with key flags', () => {
    const result = run('help-json api --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('api');
    expect(parsed.args.method).toBeDefined();
    expect(parsed.args.path).toBeDefined();
    expect(parsed.flags.data).toBeDefined();
    expect(parsed.flags.input).toBeDefined();
    expect(parsed.flags.field).toBeDefined();
    expect(parsed.flags.query).toBeDefined();
    expect(parsed.flags['dry-run']).toBeDefined();
    expect(parsed.flags.paginate).toBeDefined();
    // the schema must surface the short alias so a doc that
    // shows `-F key=val` can be verified against help-json. A flag with no
    // short alias omits `char` entirely.
    expect(parsed.flags.field.char).toBe('F');
    expect(parsed.flags.data.char).toBeUndefined();
  });

  it('help-json returns schema for discover, login, logout, config, auth', () => {
    for (const cmd of ['discover', 'login', 'logout', 'config', 'auth']) {
      const result = run(`help-json ${cmd} --json`);
      expect(result.exitCode, `help-json ${cmd} should succeed`).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.name).toBe(cmd);
    }
  });

  it('help-json exits 2 for unknown command', () => {
    const result = run('help-json nonexistent --json');
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// `agledger api`: the main event
// ---------------------------------------------------------------------------
describe('agledger api: method + path validation', () => {
  it('rejects unknown method', () => {
    const result = run('api FROGGY /v1/records --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_METHOD');
  });

  it('rejects path without leading /', () => {
    const result = run('api GET v1/records --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_PATH');
  });

  it('rejects a path containing control characters', () => {
    // \x7f (DEL) is not shell whitespace, so it reaches the arg intact.
    const result = run('api GET /v1/re\x7fcords --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_PATH');
  });

  it('normalizes lowercase method', () => {
    const result = run('api get /v1/records --dry-run --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.method).toBe('GET');
  });

  it('requires auth', () => {
    const result = run('api GET /v1/records --json --api-url http://127.0.0.1:45999');
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('AUTH_REQUIRED');
  });

  it('does NOT auto-prefix /v1/: health path passes through', () => {
    const result = run('api GET /health --dry-run --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.path).toBe('/health');
  });

  it('does NOT auto-prefix /v1/: caller keeps /v1/ explicit', () => {
    const result = run('api GET /v1/records --dry-run --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.path).toBe('/v1/records');
  });
});

describe('agledger api: --data body handling', () => {
  it('accepts --data as JSON body on POST', () => {
    const result = run(
      'api POST /v1/records --data \'{"type":"notarize-generic-v1"}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ type: 'notarize-generic-v1' });
  });

  it('routes --data to query for GET', () => {
    const result = run(
      'api GET /v1/records --data \'{"status":"ACTIVE","limit":10}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.query).toEqual({ status: 'ACTIVE', limit: 10 });
    expect(parsed.body).toBeUndefined();
  });

  it('rejects invalid --data JSON with structured error', () => {
    const result = run('api POST /v1/records --data \'{not-json}\' --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_JSON_INPUT');
    expect(parsed.message).toContain('--data');
  });
});

describe('agledger api: --input file and stdin', () => {
  it('reads JSON body from --input file', () => {
    const file = tmpJson({ type: 'principal-gate-generic-v1', criteria: { x: 1 } });
    const result = run(`api POST /v1/records --input ${file} --dry-run --json`, {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ type: 'principal-gate-generic-v1', criteria: { x: 1 } });
  });

  it('returns FILE_READ_ERROR for missing --input path', () => {
    const result = run('api POST /v1/records --input /no/such/file --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('FILE_READ_ERROR');
  });

  it('reads from stdin when --input is -', () => {
    const stdout = execSync(
      `node ${BIN} api POST /v1/records --input - --dry-run --json`,
      {
        encoding: 'utf-8',
        env: { ...process.env, AGLEDGER_API_KEY: 'agl_adm_test', AGLEDGER_API_URL: '', HOME: tmpdir() },
        input: '{"type":"delegated-workflow-v1"}',
        timeout: SPAWN_TIMEOUT,
      },
    );
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.body).toEqual({ type: 'delegated-workflow-v1' });
  });
});

describe('agledger api: -F/--field typed parsing', () => {
  it('treats bare values as strings', () => {
    const result = run('api POST /v1/x -F name=Alice --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ name: 'Alice' });
  });

  it('parses booleans, null, numbers', () => {
    const result = run(
      'api POST /v1/x -F active=true -F disabled=false -F middle=null -F count=42 -F ratio=0.5 --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ active: true, disabled: false, middle: null, count: 42, ratio: 0.5 });
  });

  it('parses nested paths with dot syntax', () => {
    const result = run(
      'api POST /v1/x -F criteria.item_spec=widgets -F criteria.quantity.target=500 --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ criteria: { item_spec: 'widgets', quantity: { target: 500 } } });
  });

  it('appends to arrays with [] syntax', () => {
    const result = run(
      'api POST /v1/webhooks -F url=https://example.com -F eventTypes[]=a -F eventTypes[]=b --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ url: 'https://example.com', eventTypes: ['a', 'b'] });
  });

  it('parses JSON literals for bracketed values', () => {
    // Single-quote the JSON literals so the shell passes them through verbatim.
    const result = run(
      `api POST /v1/x -F 'obj={"k":"v"}' -F 'arr=[1,2,3]' --dry-run --json`,
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ obj: { k: 'v' }, arr: [1, 2, 3] });
  });

  it('returns INVALID_FIELD on missing =', () => {
    const result = run('api POST /v1/x -F broken --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_FIELD');
  });
});

describe('agledger api: body-source merging', () => {
  it('merges --data then -F (later wins)', () => {
    const result = run(
      'api POST /v1/x --data \'{"a":1,"b":2}\' -F b=99 -F c=3 --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('--query overrides body for GET', () => {
    const result = run(
      'api GET /v1/records -F status=ACTIVE --query \'{"limit":5}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'agl_adm_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.query).toEqual({ status: 'ACTIVE', limit: 5 });
  });
});

describe('agledger api: --paginate', () => {
  it('--paginate rejected on non-GET', () => {
    const result = run('api POST /v1/records --paginate --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_METHOD');
  });

  it('--paginate --dry-run shows the stream intent', () => {
    const result = run('api GET /v1/records -F limit=50 --paginate --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.paginate).toBe(true);
    expect(parsed.query).toEqual({ limit: 50 });
  });
});

describe('agledger api: --dry-run + --quiet', () => {
  it('--dry-run --quiet produces no output with exit 0', () => {
    const result = run('api POST /v1/records --data \'{"x":1}\' --dry-run --quiet', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
// discover / auth
// ---------------------------------------------------------------------------
describe('discover + auth', () => {
  // discover says "call this first", so it must not demand a key.
  // The Server answers /health unauthenticated. What it does need is a URL,
  // and with neither the failure names the missing URL, not a missing key.
  it('discover without a key fails on the missing URL, not on auth', () => {
    const result = run('discover --json');
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('CONFIG_ERROR');
    expect(String(parsed.message)).toContain('No API URL configured');
  });

  // the old default was https://agledger.example.com, so a missing
  // URL surfaced as a DNS failure against a host the user never named.
  it('never falls back to a placeholder host', () => {
    const result = run('discover --json');
    expect(result.stderr).not.toContain('agledger.example.com');
  });

  it('auth with no key returns authenticated:false and exits 0', () => {
    const result = run('auth --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.authenticated).toBe(false);
  });

  // Regression for an earlier report: `auth` used to read only the --api-key
  // flag/env, so right after a successful `login` (which writes the key to a
  // stored profile) it falsely reported authenticated:false. It must now resolve
  // the stored profile and verify it; here the API is unreachable, so the fix is
  // proven by the command getting PAST the key guard (a network error) instead of
  // the old false short-circuit.
  it('auth resolves a stored profile instead of reporting not-authenticated', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        profiles: { default: { apiKey: 'agl_adm_stored', apiUrl: 'http://127.0.0.1:9' } },
        activeProfile: 'default',
      }),
      { flag: 'w', mode: 0o600 },
    );
    const result = run('auth --json', { HOME: home });
    // Got past the key guard: it attempted verification and hit the unreachable
    // API, rather than the pre-fix `{authenticated:false, "No API key configured"}`.
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain('No API key configured');
    expect(combined).not.toContain('"authenticated":false');
    rmSync(home, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// login + logout + config: CLI-local
// ---------------------------------------------------------------------------
describe('login + logout + config', () => {
  it('login without --api-key fails', () => {
    const home = isolatedHome();
    const result = run('login --json', { HOME: home });
    expect(result.exitCode).toBe(3);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('AUTH_REQUIRED');
    rmSync(home, { recursive: true, force: true });
  });

  it('config list on empty config returns empty profiles', () => {
    const home = isolatedHome();
    const result = run('config list --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.profiles).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });

  it('config path returns the config location', () => {
    const home = isolatedHome();
    const result = run('config path --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.path).toBe(join(home, '.agledger', 'config.json'));
    rmSync(home, { recursive: true, force: true });
  });

  it('config use on non-existent profile fails with MISSING_INPUT', () => {
    const home = isolatedHome();
    const result = run('config use nope --json', { HOME: home });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('MISSING_INPUT');
    rmSync(home, { recursive: true, force: true });
  });

  it('logout on non-existent profile says nothing was removed and exits 2', () => {
    const home = isolatedHome();
    const result = run('logout --profile ghost --json', { HOME: home });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('MISSING_INPUT');
    expect(String(parsed.message)).toContain("'ghost'");
    rmSync(home, { recursive: true, force: true });
  });

  it('logout with no profiles at all exits 2 rather than reporting success', () => {
    const home = isolatedHome();
    const result = run('logout --json', { HOME: home });
    expect(result.exitCode).toBe(2);
    expect(parseJson(result).code).toBe('MISSING_INPUT');
    rmSync(home, { recursive: true, force: true });
  });

  // A plain logout used to act on the profile named `default`, so after
  // `config use prod` it removed nothing, exited 0, and left prod in use.
  it('logout with no flags removes the active profile, not one named default', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const configPath = join(configDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: { default: { apiKey: 'k1' }, prod: { apiKey: 'k2', apiUrl: 'https://prod.example' } },
        activeProfile: 'default',
      }),
      { flag: 'w', mode: 0o600 },
    );
    expect(run('config use prod --json', { HOME: home }).exitCode).toBe(0);

    const result = run('logout --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedOut: true, profile: 'prod', activeProfile: null });
    const final = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(final.profiles).not.toHaveProperty('prod');
    expect(final.profiles).toHaveProperty('default');
    rmSync(home, { recursive: true, force: true });
  });

  // Logging out the active profile used to make the first remaining one active,
  // so an admin profile stored beside an agent one took over the next call.
  it('logout of the active profile leaves none active and says so', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const configPath = join(configDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: { adm: { apiKey: 'agl_adm_k', apiUrl: 'https://x.example' }, agt: { apiKey: 'agl_agt_k', apiUrl: 'https://x.example' } },
        activeProfile: 'agt',
      }),
      { mode: 0o600 },
    );
    const result = run('logout --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out).toMatchObject({ loggedOut: true, profile: 'agt', activeProfile: null });
    expect(out.note).toContain('config use');
    expect(out.note).toContain('adm');
    const final = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(final.activeProfile).toBeUndefined();
    expect(final.profiles).toHaveProperty('adm');

    // A profile that was not active leaves the active one alone.
    writeFileSync(configPath, JSON.stringify({ profiles: { adm: { apiKey: 'a' }, agt: { apiKey: 'b' } }, activeProfile: 'agt' }), { mode: 0o600 });
    const other = JSON.parse(run('logout --profile adm --json', { HOME: home }).stdout);
    expect(other).toMatchObject({ profile: 'adm', activeProfile: 'agt' });
    expect(other.note).toBeUndefined();
    rmSync(home, { recursive: true, force: true });
  });

  it('logout --all with nothing stored exits 2 like a plain logout', () => {
    const home = isolatedHome();
    const result = run('logout --all --json', { HOME: home });
    expect(result.exitCode).toBe(2);
    expect(parseJson(result).code).toBe('MISSING_INPUT');
    rmSync(home, { recursive: true, force: true });
  });

  it('logout --all removes every profile and the active one', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const configPath = join(configDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ profiles: { a: { apiKey: 'k' }, b: { apiKey: 'k' } }, activeProfile: 'a' }), { mode: 0o600 });
    const result = run('logout --all --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedOut: true, removedProfiles: ['a', 'b'] });
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({ profiles: {} });
    rmSync(home, { recursive: true, force: true });
  });

  // A --profile naming nothing was ignored whenever env or flag credentials
  // were set, running the call as a credential the caller did not mean.
  it('--profile naming no stored profile exits 3 even with env or flag credentials', () => {
    const home = isolatedHome();
    const env = { HOME: home, AGLEDGER_API_KEY: 'agl_agt_env', AGLEDGER_API_URL: 'http://127.0.0.1:9' };
    for (const cmd of [
      'api GET /v1/auth/me --profile nope --json',
      'api GET /v1/auth/me --profile nope --api-key agl_agt_flag --api-url http://127.0.0.1:9 --json',
      'api GET /v1/auth/me --profile nope --dry-run --json',
    ]) {
      const result = run(cmd, env);
      expect(result.exitCode, cmd).toBe(3);
      const parsed = parseJson(result);
      expect(parsed.code).toBe('AUTH_REQUIRED');
      expect(String(parsed.message)).toBe("Profile 'nope' not found.");
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves auth from a stored profile when no --api-key flag/env is set', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        profiles: { default: { apiKey: 'agl_adm_fromprofile', apiUrl: 'https://stored.example' } },
        activeProfile: 'default',
      }),
      { flag: 'w', mode: 0o600 },
    );

    // No --api-key flag, and the env keys are blanked by `run`. The call must
    // still resolve credentials from the active stored profile.
    const result = run('api GET /v1/records --dry-run --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.auth.source).toBe('profile');
    expect(parsed.auth.profile).toBe('default');
    expect(parsed.auth.apiUrl).toBe('https://stored.example');
    expect(parsed.auth.apiKey).toBe('****file'); // masked: last 4 chars of agl_adm_fromprofile
    rmSync(home, { recursive: true, force: true });
  });

  it('--profile selects a specific stored profile for credentials', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        profiles: {
          default: { apiKey: 'agl_adm_defaultkey', apiUrl: 'https://default.example' },
          prod: { apiKey: 'agl_adm_prodkey', apiUrl: 'https://prod.example' },
        },
        activeProfile: 'default',
      }),
      { flag: 'w', mode: 0o600 },
    );

    const result = run('api GET /v1/records --profile prod --dry-run --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.auth.profile).toBe('prod');
    expect(parsed.auth.apiUrl).toBe('https://prod.example');
    expect(parsed.auth.apiKey).toBe('****dkey');
    rmSync(home, { recursive: true, force: true });
  });

  it('--api-key flag outranks a stored profile', () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        profiles: { default: { apiKey: 'agl_adm_profilekey', apiUrl: 'https://profile.example' } },
        activeProfile: 'default',
      }),
      { flag: 'w', mode: 0o600 },
    );

    const result = run('api GET /v1/records --api-key agl_adm_flagkey --dry-run --json', {
      HOME: home,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.auth.source).toBe('flag-or-env');
    expect(parsed.auth.apiKey).toBe('****gkey');
    rmSync(home, { recursive: true, force: true });
  });

  it('config round-trip: write via util, read back', () => {
    const home = isolatedHome();
    // Seed config manually (login requires a live API).
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const configPath = join(configDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify(
        { profiles: { default: { apiKey: 'k1' }, prod: { apiKey: 'k2', apiUrl: 'https://prod' } }, activeProfile: 'default' },
        null,
        2,
      ),
      { flag: 'w', mode: 0o600 },
    );

    const list = run('config list --json', { HOME: home });
    const parsed = JSON.parse(list.stdout);
    expect(parsed.activeProfile).toBe('default');
    expect(parsed.profiles).toHaveLength(2);

    const switched = run('config use prod --json', { HOME: home });
    expect(switched.exitCode).toBe(0);
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.activeProfile).toBe('prod');

    const removed = run('logout --profile default --json', { HOME: home });
    expect(removed.exitCode).toBe(0);
    const final = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(final.profiles).not.toHaveProperty('default');
    expect(final.profiles).toHaveProperty('prod');

    rmSync(home, { recursive: true, force: true });
  });

});

// ---------------------------------------------------------------------------
// Exit codes + error output
// ---------------------------------------------------------------------------
describe('exit codes', () => {
  it('unknown command exits non-zero', () => {
    const result = run('nonexistent');
    expect(result.exitCode).not.toBe(0);
  });

  it('missing required arg exits 2', () => {
    const result = run('api --json');
    expect(result.exitCode).toBe(2);
  });
});

describe('error output format', () => {
  it('auth error is valid JSON with code, message, suggestion', () => {
    const result = run('api GET /v1/records --json --api-url http://127.0.0.1:45999');
    const parsed = parseJson(result);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('AUTH_REQUIRED');
    expect(parsed.message).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// verify: offline audit-export verification (no network, no API key required)
// ---------------------------------------------------------------------------
describe('verify command', () => {
  const VECTORS = resolve(import.meta.dirname, '../testdata/conformance/export');

  it('exits 0 on a valid export', () => {
    const result = run(`verify ${VECTORS}/valid.json --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.verifiedEntries).toBe(3);
    expect(parsed.totalEntries).toBe(3);
    expect(parsed.brokenAt).toBeUndefined();
  });

  it('exits 1 on tampered payload and surfaces brokenAt', () => {
    const result = run(`verify ${VECTORS}/hash-mismatch.json --json`);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.brokenAt.position).toBe(2);
    expect(parsed.brokenAt.code).toBe('CHAIN_HASH_MISMATCH');
  });

  it('exits 1 on broken chain', () => {
    const result = run(`verify ${VECTORS}/link-broken.json --json`);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.brokenAt.code).toBe('CHAIN_LINK_BROKEN');
  });

  it('requires no API key (runs fully offline)', () => {
    const result = run(`verify ${VECTORS}/valid.json --json`, {
      AGLEDGER_API_KEY: '',
      AGLEDGER_API_URL: '',
    });
    expect(result.exitCode).toBe(0);
  });

  it('accepts --keys override', () => {
    const result = run(
      `verify ${VECTORS}/valid.json --keys ${VECTORS}/keys-oob.json --json`,
    );
    expect(result.exitCode).toBe(0);
  });

  it('accepts the raw GET /v1/verification-keys envelope shape for --keys', () => {
    // The endpoint returns `{ data: [{ keyId, publicKey }], ... }`, not a bare
    // array; the CLI must unwrap `.data` so a saved GET response works as the
    // --help text promises, without hand-extracting the array first.
    const map = JSON.parse(readFileSync(`${VECTORS}/keys-oob.json`, 'utf-8')) as Record<
      string,
      string
    >;
    const envelope = {
      data: Object.entries(map).map(([keyId, publicKey]) => ({ keyId, publicKey })),
      canonicalization: 'RFC8949-CDE',
      payloadFormat: 'spki-der-base64',
    };
    const dir = mkdtempSync(join(tmpdir(), 'agledger-keys-'));
    const keysFile = join(dir, 'vkeys.json');
    writeFileSync(keysFile, JSON.stringify(envelope));
    try {
      const result = run(
        `verify ${VECTORS}/valid.json --keys ${keysFile} --require-supplied-keys --json`,
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).valid).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('labels the short-circuited signature "not-checked", not "skipped"', () => {
    // On an upstream chain break, downstream entries never reach the signature
    // check; the label must read as a consequence of the break, not a benign skip.
    const result = run(`verify ${VECTORS}/hash-mismatch.json --json`);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    const broken = parsed.entries.find((e: { valid: boolean }) => !e.valid);
    expect(broken.signature).toBe('not-checked');
  });

  const PIN = 'sha256:15d63684b387235c47fe3a81e3004b928f4ea535236a2c1b47465ce5fdd7ce0e';

  it('reports keyTrust no_anchor in JSON without --trust-anchor, and walked with one', () => {
    const none = JSON.parse(run(`verify ${VECTORS}/valid.json --json`).stdout);
    expect(none.keyTrust.status).toBe('no_anchor');
    expect(none.optionalChecks.key_anchoring).toBe('skipped_no_input');
    const pinned = run(`verify ${VECTORS}/valid.json --trust-anchor ${PIN} --json`);
    expect(pinned.exitCode).toBe(0);
    const parsed = JSON.parse(pinned.stdout);
    expect(parsed.keyTrust).toMatchObject({ status: 'walked', anchoredFromPinned: true, unanchoredKeyIds: [] });
    expect(parsed.optionalChecks.key_anchoring).toBe('applied');
  });

  it('fails a key no statement links to the anchor with CHAIN_SIGNING_KEY_UNANCHORED', () => {
    const result = run(`verify ${VECTORS}/valid.json --trust-anchor sha256:${'ab'.repeat(32)} --json`);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).brokenAt).toMatchObject({ position: 1, code: 'CHAIN_SIGNING_KEY_UNANCHORED' });
  });

  it('a pinned key distrusted with no instant, and --distrusted-key without --trust-anchor, are usage errors', () => {
    const result = run(`verify ${VECTORS}/valid.json --trust-anchor ${PIN} --distrusted-key ${PIN} --json`);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).toContain('INVALID_FIELD');
    const alone = run(`verify ${VECTORS}/valid.json --distrusted-key ${PIN} --json`);
    expect(alone.exitCode).toBe(2);
    expect(alone.stdout + alone.stderr).toContain('MISSING_INPUT');
  });

  it('a pin beside a dated --distrusted-key for the same key is taken: it vouches for what the key signed before the instant', () => {
    const after = run(`verify ${VECTORS}/valid.json --trust-anchor ${PIN} --distrusted-key ${PIN}@2099-01-01T00:00:00Z --json`);
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout)).toMatchObject({ verdict: 'trusted', keyTrust: { accounted: [] } });
    // An export accounts for nothing: what the key signed from the instant on fails.
    const before = run(`verify ${VECTORS}/valid.json --trust-anchor ${PIN} --distrusted-key ${PIN}@2026-09-01T00:00:00Z --json`);
    expect(before.exitCode).toBe(1);
    expect(JSON.parse(before.stdout).brokenAt).toMatchObject({ code: 'CHAIN_KEY_EXPIRED' });
  });

  it('a malformed --trust-anchor is a usage error naming the flag, not the keys file', () => {
    const result = run(`verify ${VECTORS}/valid.json --trust-anchor 15d63684 --json`);
    expect(result.exitCode).toBe(2);
    const out = result.stdout + result.stderr;
    expect(out).toContain('INVALID_FIELD');
    expect(out).toContain('--trust-anchor sha256:<64 hex>');
    expect(out).not.toContain('--keys file');
  });

  // The same inputs, messages and exit codes as @agledger/verify and the
  // Python agledger-verify: each is refused before the export is read.
  const APIN = `sha256:${'a'.repeat(64)}`;
  it.each([
    [`/nonexistent --trust-anchor abc`, '--trust-anchor "abc" is not sha256:<64 hex>. Each anchor is the full SHA-256'],
    [`/nonexistent --trust-anchor ${APIN},${APIN}`, `--trust-anchor "${APIN},${APIN}" is not sha256:<64 hex>.`],
    [`/nonexistent --trust-anchor ${APIN} --distrusted-key ${APIN}@2026-02-30T00:00:00Z`, `--distrusted-key "${APIN}@2026-02-30T00:00:00Z" is not sha256:<64 hex>, optionally followed by @<RFC 3339 instant>`],
    [`/nonexistent --trust-anchor ${APIN} --distrusted-key ${APIN} --distrusted-key ${APIN}`, `--distrusted-key names ${APIN} twice.`],
    [`/nonexistent --distrusted-key ${APIN}`, '--distrusted-key acts only inside the key-statement walk, which runs from --trust-anchor; pass the pin as well.'],
    [`/nonexistent --trust-anchor ${APIN} --distrusted-key ${APIN}`, `${APIN} is a --trust-anchor and a --distrusted-key with no instant, which leaves the pin nothing to vouch for. Give the distrust entry the instant the key leaked`],
    [`/nonexistent --trust-anchor ${APIN} --distrusted-key ${APIN}@2026-09-01T00:00:00Z`, 'Cannot read /nonexistent: no such file or directory.'],
    [`/nonexistent --trust-anchor ${APIN}`, 'Cannot read /nonexistent: no such file or directory.'],
    [`/nonexistent --distrusted-keys ${APIN}`, '--distrusted-keys is now --distrusted-key, given once per key: --distrusted-key sha256:<hex>[@<RFC 3339 instant>].'],
    [`/nonexistent --require-out-of-band-keys`, '--require-out-of-band-keys is now --require-supplied-keys'],
  ])('verify %s exits 2 with the shared message', (args, message) => {
    const result = run(`verify ${args} --json`);
    expect(result.exitCode).toBe(2);
    expect(String(parseJson(result).message).startsWith(message)).toBe(true);
  });

  it('usage error exit 2 on missing file arg', () => {
    const result = run('verify --json');
    expect(result.exitCode).toBe(2);
  });

  // A live API 2.0.0 export whose create, completion and verdict were sent
  // under a cert with signed bodies, and the cert's public key as the agent
  // kept it.
  const LIVE = resolve(import.meta.dirname, '../testdata/live-2.0.0');

  it('counts sealed agent signatures but checks none without --agent-keys', () => {
    const result = run(`verify ${LIVE}/export-cert-lifecycle.json --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.agentSignatures).toEqual({ present: 6, verified: 0 });
    expect(parsed.optionalChecks.agent_signature).toBe('skipped_no_input');
  });

  it('re-verifies every sealed agent signature with --agent-keys, unwrapping {publicKeyJwk}', () => {
    const result = run(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${LIVE}/agent-cert-key.json --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.agentSignatures).toEqual({ present: 6, verified: 6 });
    expect(parsed.optionalChecks.agent_signature).toBe('applied');
  });

  it('accepts a bare JWK list and a JWK Set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agl-agent-keys-'));
    const jwk = JSON.parse(readFileSync(`${LIVE}/agent-cert-key.json`, 'utf8')).publicKeyJwk;
    for (const [name, body] of [['list.json', [jwk]], ['set.json', { keys: [jwk] }]] as const) {
      writeFileSync(join(dir, name), JSON.stringify(body));
      const result = run(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${join(dir, name)} --json`);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).agentSignatures.verified).toBe(6);
    }
  });

  it('a key for another cert matches nothing and verifies nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agl-agent-keys-'));
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    writeFileSync(join(dir, 'other.json'), JSON.stringify([other]));
    const result = run(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${join(dir, 'other.json')} --json`);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).agentSignatures).toEqual({ present: 6, verified: 0 });
  });

  // Human output needs a TTY (piped stdout means JSON), so run under script(1).
  const human = (args: string): string =>
    execSync(`script -qec ${JSON.stringify(`node ${BIN} ${args}`)} /dev/null`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tmpdir(), NO_COLOR: '1' },
    });

  it('human output says how many agent signatures were checked, and PASS speaks for the Server signatures only', () => {
    const none = human(`verify ${LIVE}/export-cert-lifecycle.json`);
    expect(none).toContain('Agent signatures: 6 sealed on the chain, not checked. Pass --agent-keys');
    expect(none).toContain('every Server signature verifies');
    expect(none).not.toContain('every signature verified');

    const dir = mkdtempSync(join(tmpdir(), 'agl-agent-keys-'));
    writeFileSync(join(dir, 'other.json'), JSON.stringify([generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })]));
    const miss = human(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${join(dir, 'other.json')}`);
    expect(miss).toContain('0/6 re-verified offline; 6 name a key that is not in --agent-keys and were not checked');
    expect(miss).not.toContain('Pass --agent-keys');

    const all = human(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${LIVE}/agent-cert-key.json`);
    expect(all).toContain('Agent signatures: 6/6 re-verified offline against --agent-keys.');
  });

  it('human output lists a key note: an honest rotation off a key distrusted after it passes, and says what was voided', () => {
    const fx = resolve(import.meta.dirname, 'fixtures/distrusted-rotation');
    const { pin, distrust } = JSON.parse(readFileSync(join(fx, 'meta.json'), 'utf-8')) as { pin: string; distrust: string };
    const out = human(`verify ${fx}/export.json --keys ${fx}/keys.json --trust-anchor ${pin} --distrusted-key ${distrust}`);
    expect(out).toContain('PASS  Record:');
    expect(out).toMatch(/Key note: \([0-9a-f]{16}\) a succession by [0-9a-f]{16}, which --distrusted-key distrusts/);
  });

  describe('an export after a dated distrust entry', () => {
    // A live API 2.0.0 export of a record its first key K signed, taken after
    // the Server retired K with force from its successor F and restarted with
    // VAULT_DISTRUSTED_KEYS=sha256:<K>@<instant>: signingKeyWindows lists K
    // retired at that instant, with distrustedFrom.
    const X = resolve(import.meta.dirname, '../testdata/live-2.0.0/export-dated-distrust.json');
    const F = 'sha256:78e7bba47a2dccdb1dbf4f2dc81dc58a5c58735abe480de49d05081d3452aa3a';
    const K = 'sha256:b649db0ec7c5c0fd921c2cb4d40466d91f4d98252dad2f7c0243851167b2d09e';
    const FROM = '2026-10-05T23:03:51.537314Z';

    it('pinned on F alone fails CHAIN_KEY_WINDOW_DRIFT naming the --distrusted-key the Server applies, in JSON and human output', () => {
      const json = run(`verify ${X} --trust-anchor ${F} --json`);
      expect(json.exitCode).toBe(1);
      const parsed = JSON.parse(json.stdout);
      expect(parsed).toMatchObject({ verdict: 'failed', brokenAt: { position: 0, code: 'CHAIN_KEY_WINDOW_DRIFT' } });
      const advice = `this walk was given no distrust entry for it. If the operator confirms it, give --distrusted-key ${K}@${FROM}.`;
      expect(parsed.brokenAt.detail).toContain(advice);
      expect(parsed.keyTrust.findings[0].detail).toContain(advice);
      expect(json.stdout).not.toMatch(/distrustedKeys|trustAnchors/);

      // A failing run exits 1, which execSync raises; the rendered report rides on the error.
      let text = '';
      let status = 0;
      try {
        text = human(`verify ${X} --trust-anchor ${F}`);
      } catch (err) {
        text = String((err as { stdout?: string }).stdout);
        status = (err as { status?: number }).status ?? -1;
      }
      expect(status).toBe(1);
      expect(text).toContain('FAIL  Record:');
      expect(text).toContain('Key finding: CHAIN_KEY_WINDOW_DRIFT (b649db0ec7c5c0fd): retiredAt 2026-10-05T23:03:51.537Z is listed as the Server\'s distrust cutoff');
      expect(text.replace(/\r?\n\s*/g, ' ')).toContain(advice);
      expect(text).not.toMatch(/distrustedKeys|trustAnchors/);
    });

    it('pinned on F with K at the listed instant passes; at a later instant fails saying the entries disagree; at an earlier one passes with a note', () => {
      const same = run(`verify ${X} --trust-anchor ${F} --distrusted-key ${K}@${FROM} --json`);
      expect(same.exitCode).toBe(0);
      expect(JSON.parse(same.stdout)).toMatchObject({ verdict: 'trusted', keyTrust: { findings: [], notes: [] } });

      const later = run(`verify ${X} --trust-anchor ${F} --distrusted-key ${K}@2026-10-05T23:04:00Z --json`);
      expect(later.exitCode).toBe(1);
      expect(JSON.parse(later.stdout).brokenAt.detail).toContain(
        `the distrust entry given for it (from 2026-10-05T23:04:00.000000Z) and the one the listing says the Server applies (VAULT_DISTRUSTED_KEYS, from ${FROM}) disagree.`,
      );

      const earlier = human(`verify ${X} --trust-anchor ${F} --distrusted-key ${K}@2026-10-05T23:03:50Z`);
      expect(earlier).toContain('PASS  Record:');
      expect(earlier).toContain(`Key note: (b649db0ec7c5c0fd) --distrusted-key gives b649db0ec7c5c0fd the instant 2026-10-05T23:03:50.000000Z, and the listing says the Server distrusts it from ${FROM}`);
    });
  });

  it('human output says PASS only for an anchored chain, and never reads an unanchored one as a clean pass', () => {
    const none = human(`verify ${VECTORS}/valid.json`);
    expect(none).toContain('VERIFIED, NOT ANCHORED  Record:');
    expect(none).not.toContain('PASS');
    expect(none).toContain('Nothing failed, but this is NOT a trusted verdict: no --trust-anchor was given');
    expect(none).toContain('Keys: not anchored (no --trust-anchor given), checked against keys nobody pinned.');
    expect(none).not.toContain('linked to your trust anchor');

    const pinned = human(`verify ${VECTORS}/valid.json --trust-anchor ${PIN}`);
    expect(pinned).toContain('PASS  Record:');
    expect(pinned).toContain(`Keys: 1 anchored to --trust-anchor ${PIN}.`);
    expect(pinned).toContain('every Server signature verified under a key linked to your trust anchor');

    // A failing run exits 1, which execSync raises; the rendered report rides on the error.
    let substituted = '';
    try {
      human(`verify ${VECTORS}/key-substitution.json --trust-anchor ${PIN}`);
    } catch (err) {
      substituted = String((err as { stdout?: string }).stdout);
    }
    expect(substituted).toContain('FAIL  Record:');
    expect(substituted).toContain('Broken at position 2: CHAIN_SIGNING_KEY_UNANCHORED');
    expect(substituted).not.toContain('linked to your trust anchor');
    expect(substituted).not.toContain('Hash chain contiguous');
  });

  it('the headline words and exit code per verdict, as @agledger/verify and the Python agledger-verify print them', () => {
    const cases: Array<[string, number, string]> = [
      [`verify ${VECTORS}/valid.json --trust-anchor ${PIN}`, 0, 'PASS  Record:'],
      [`verify ${VECTORS}/valid.json`, 0, 'VERIFIED, NOT ANCHORED  Record:'],
      [`verify ${VECTORS}/valid.json --trust-anchor sha256:${'ab'.repeat(32)}`, 1, 'FAIL  Record:'],
    ];
    const verdicts = ['trusted', 'unanchored', 'failed'];
    cases.forEach(([args, code, headline], i) => {
      let stdout = '';
      let status = 0;
      try {
        stdout = human(args);
      } catch (err) {
        stdout = String((err as { stdout?: string }).stdout);
        status = (err as { status?: number }).status ?? -1;
      }
      expect(status).toBe(code);
      expect(stdout.startsWith(headline)).toBe(true);
      const json = run(`${args} --json`);
      expect(json.exitCode).toBe(code);
      expect(JSON.parse(json.stdout).verdict).toBe(verdicts[i]);
    });
  });

  it('a pinned run that verified no signature under an anchored key is unanchored, not trusted', () => {
    const unsigned = `${VECTORS}/unsigned.json --keys ${VECTORS}/keys-oob.json --trust-anchor ${PIN}`;
    const json = run(`verify ${unsigned} --json`);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.keyTrust.status).toBe('no_anchored_signature');
    expect(parsed.verdict).toBe('unanchored');

    const out = human(`verify ${unsigned}`);
    expect(out.startsWith('VERIFIED, NOT ANCHORED  Record:')).toBe(true);
    expect(out).not.toContain('PASS');
    expect(out).toContain('Nothing failed, but this is NOT a trusted verdict: the --trust-anchor was walked, but no signature here verified under a key it anchors.');
    expect(out).toContain(`Keys: walked from --trust-anchor ${PIN}; no signature verified under an anchored key.`);
    expect(out).not.toContain('linked to your trust anchor.');
  });

  it('takes FILE after a repeatable flag, and refuses a missing FILE without advertising retired flags', () => {
    const after = run(`verify --trust-anchor ${PIN} --distrusted-key sha256:${'cd'.repeat(32)} ${VECTORS}/valid.json --json`);
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout).keyTrust.status).toBe('walked');

    const missing = run(`verify --trust-anchor ${PIN} --json`);
    expect(missing.exitCode).toBe(2);
    expect(JSON.parse(missing.stdout || missing.stderr).code).toBe('MISSING_INPUT');
    expect(missing.stdout + missing.stderr).not.toContain('--distrusted-keys');
    expect(run('verify --help').stdout).not.toContain('--distrusted-keys');
  });

  it('human output names unsigned entries as covered by the hash chain only', () => {
    const out = human(`verify ${VECTORS}/unsigned.json --keys ${VECTORS}/keys-oob.json`);
    expect(out).toContain('Unsigned: 3 of 3 entries carry no signature');
  });

  it('refuses a file that is not an Ed25519 JWK with a usage error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agl-agent-keys-'));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ kty: 'OKP', crv: 'Ed25519' }));
    const result = run(`verify ${LIVE}/export-cert-lifecycle.json --agent-keys ${join(dir, 'bad.json')} --json`);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).toContain('INVALID_FIELD');
  });

  it('refuses a --keys window that is not RFC 3339 with a usage error naming the key', () => {
    const exp = JSON.parse(readFileSync(`${LIVE}/export-cert-lifecycle.json`, 'utf8')) as { exportMetadata: { signingPublicKeys: Record<string, string> } };
    const [keyId, publicKey] = Object.entries(exp.exportMetadata.signingPublicKeys)[0]!;
    const dir = mkdtempSync(join(tmpdir(), 'agl-keys-'));
    writeFileSync(join(dir, 'keys.json'), JSON.stringify({ data: [{ keyId, publicKey, activatedAt: 'yesterday' }] }));
    const result = run(`verify ${LIVE}/export-cert-lifecycle.json --keys ${join(dir, 'keys.json')} --json`);
    expect(result.exitCode).toBe(2);
    expect(parseJson(result)).toMatchObject({ code: 'INVALID_FIELD', message: expect.stringContaining(`(key ${keyId}) has activatedAt "yesterday", which is not an RFC 3339 instant`) });
  });
});

// ---------------------------------------------------------------------------
// verify: full vendored conformance corpus, manifest-driven. Every vector in
// manifest-export.json runs through the built CLI, so a regression in the
// verify-core dispatch (e.g. an Ed25519-only build) fails here instead of
// staying green behind the handful of hand-picked vectors above.
// ---------------------------------------------------------------------------
describe('verify command: conformance corpus (manifest-export.json)', () => {
  const CONFORMANCE = resolve(import.meta.dirname, '../testdata/conformance');
  interface ManifestVector {
    file: string;
    kind: string;
    expect: 'pass' | 'fail';
    failureCode?: string;
    brokenAt?: number;
    options?: {
      keysFile?: string;
      requireKeyId?: string;
      requireSuppliedKeys?: boolean;
      /**
       * A JSON array of agent cert public keys. Unmapped, a vector expecting
       * CHAIN_AGENT_SIGNATURE_INVALID runs with no agent keys, the check
       * reports skipped_no_input, the export passes, and the suite fails on a
       * vector that was never actually exercised.
       */
      agentKeysFile?: string;
    };
  }
  const manifest = JSON.parse(
    readFileSync(join(CONFORMANCE, 'manifest-export.json'), 'utf-8'),
  ) as { vectors: ManifestVector[] };

  const flagsFor = (vector: ManifestVector): string => {
    let flags = vector.options?.keysFile
      ? ` --keys ${join(CONFORMANCE, vector.options.keysFile)}`
      : '';
    if (vector.options?.requireKeyId) flags += ` --require-key-id ${vector.options.requireKeyId}`;
    if (vector.options?.agentKeysFile) {
      flags += ` --agent-keys ${join(CONFORMANCE, vector.options.agentKeysFile)}`;
    }
    if (vector.options?.requireSuppliedKeys) flags += ' --require-supplied-keys';
    return flags;
  };
  // An option flagsFor does not map runs the vector without it, and a renamed
  // key then passes or fails for the wrong reason.
  it('maps every option the manifest uses', () => {
    const mapped = new Set(['keysFile', 'requireKeyId', 'requireSuppliedKeys', 'agentKeysFile']);
    const used = new Set(manifest.vectors.flatMap((v) => Object.keys(v.options ?? {})));
    expect([...used].filter((k) => !mapped.has(k))).toEqual([]);
  });
  interface Parsed {
    valid: boolean;
    brokenAt?: { code: string; position: number };
    keyTrust: { status: string };
  }

  for (const vector of manifest.vectors) {
    const label =
      vector.expect === 'pass'
        ? `${vector.file} -> pass`
        : `${vector.file} -> fail (${vector.failureCode})`;
    it(label, () => {
      const result = run(`verify ${join(CONFORMANCE, vector.file)}${flagsFor(vector)} --json`);
      const parsed = JSON.parse(result.stdout) as Parsed;
      // The manifest pins no anchor, so the JSON must say no key was anchored.
      expect(parsed.keyTrust.status).toBe('no_anchor');
      if (vector.expect === 'pass') {
        expect(result.exitCode).toBe(0);
        expect(parsed.valid).toBe(true);
        expect(parsed.brokenAt).toBeUndefined();
      } else {
        expect(result.exitCode).toBe(1);
        expect(parsed.valid).toBe(false);
        expect(parsed.brokenAt?.code).toBe(vector.failureCode);
        if (vector.brokenAt !== undefined) {
          expect(parsed.brokenAt?.position).toBe(vector.brokenAt);
        }
      }
    });
  }

  // Pinned on the key each export names, every verdict holds except the
  // substituted key, which no signed statement admits.
  const STRANGER = `sha256:${'ab'.repeat(32)}`;
  for (const vector of manifest.vectors) {
    const substituted = vector.expect === 'pass' && vector.file === 'export/key-substitution.json';
    it(`${vector.file} --trust-anchor -> ${substituted ? 'fail (CHAIN_SIGNING_KEY_UNANCHORED)' : vector.expect}`, () => {
      const exp = JSON.parse(readFileSync(join(CONFORMANCE, vector.file), 'utf-8')) as {
        exportMetadata: { anchoredFrom?: string | null };
      };
      const anchor = exp.exportMetadata.anchoredFrom ?? STRANGER;
      const result = run(`verify ${join(CONFORMANCE, vector.file)}${flagsFor(vector)} --trust-anchor ${anchor} --json`);
      const parsed = JSON.parse(result.stdout) as Parsed;
      const pass = vector.expect === 'pass' && !substituted;
      expect(result.exitCode).toBe(pass ? 0 : 1);
      expect(parsed.valid).toBe(pass);
      // Trusted only when a signature verified under an anchored key: a pass
      // over unsigned entries alone is unanchored however the walk went.
      if (pass) {
        expect((parsed as Parsed & { verdict: string }).verdict).toBe(
          parsed.keyTrust.status === 'walked' ? 'trusted' : 'unanchored',
        );
        if (vector.file === 'export/unsigned.json') expect(parsed.keyTrust.status).toBe('no_anchored_signature');
      }
      if (substituted) expect(parsed.brokenAt).toMatchObject({ code: 'CHAIN_SIGNING_KEY_UNANCHORED', position: 2 });
      else if (!pass) expect(parsed.brokenAt?.code).toBe(vector.failureCode);
    });
  }
});

// ---------------------------------------------------------------------------
// first-run and error-surface contracts
// ---------------------------------------------------------------------------
describe('keyless discovery + error surfaces', () => {
  // These paths answer without an Authorization header, so the CLI
  // must not refuse them client-side. A bogus URL is fine: we assert the
  // request was attempted (a network failure), never AUTH_REQUIRED.
  // A closed port on loopback: connects fast and fails with ECONNREFUSED.
  const unreachable = 'http://127.0.0.1:45999';

  for (const cmd of [
    'api GET /health',
    'api GET /llms.txt',
    'api GET /openapi.json',
    'api GET /v1/conformance',
  ]) {
    it(`\`${cmd}\` is attempted without a key`, () => {
      const result = run(`${cmd} --json --api-url ${unreachable}`);
      const parsed = parseJson(result);
      expect(parsed.code).not.toBe('AUTH_REQUIRED');
      expect(parsed.code).toBe('NETWORK_ERROR');
    });
  }

  it('a write still requires a key', () => {
    const result = run(`api POST /v1/records --data '{"x":1}' --json --api-url ${unreachable}`);
    expect(parseJson(result).code).toBe('AUTH_REQUIRED');
  });

  it('a non-public GET still requires a key', () => {
    const result = run(`api GET /v1/records --json --api-url ${unreachable}`);
    expect(parseJson(result).code).toBe('AUTH_REQUIRED');
  });

  // "fetch failed" alone could not distinguish DNS from refusal.
  it('NETWORK_ERROR names the URL it tried and the cause code', () => {
    const result = run(`api GET /health --json --api-url ${unreachable}`);
    const parsed = parseJson(result);
    expect(String(parsed.message)).toContain(unreachable);
    expect(String(parsed.message)).toMatch(/ECONNREFUSED|ENOTFOUND|EADDRNOTAVAIL/);
  });

  // verify has neither --data nor --input, so it must not borrow
  // the api command's recovery text.
  it('verify does not suggest flags it does not have', () => {
    const result = run('verify /nonexistent-path-for-test.json --json');
    expect(result.exitCode).not.toBe(0);
    const suggestion = String(parseJson(result).suggestion ?? '');
    expect(suggestion).not.toContain('--data');
    expect(suggestion).not.toContain('--input');
  });

  it('verify does not suggest api-only flags on malformed JSON either', () => {
    const bad = tmpJson('not-an-export');
    writeFileSync(bad, '{ this is not json');
    const result = run(`verify ${bad} --json`);
    expect(result.exitCode).not.toBe(0);
    const suggestion = String(parseJson(result).suggestion ?? '');
    expect(suggestion).not.toContain('--data');
    expect(suggestion).not.toContain('--input');
  });

  // An unknown verb gave no nearest match and no way forward.
  it('an unknown command suggests a nearest match and a way forward', () => {
    const result = run('discovr --json');
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('COMMAND_NOT_FOUND');
    expect(parsed.didYouMean).toBe('discover');
    expect(String(parsed.suggestion)).toContain('list-commands');
  });
});

// ---------------------------------------------------------------------------
// --dry-run must describe the call the CLI would actually make
// ---------------------------------------------------------------------------
describe('--dry-run reports the real resolved URL', () => {
  // The agledger.example.com placeholder was removed from createApiClient,
  // but resolvedAuth kept its own copy. The result was a
  // dry run that reported a host the real call refuses to use: --dry-run
  // printed apiUrl agledger.example.com and exited 0, while the identical
  // invocation without --dry-run exited 2 with CONFIG_ERROR.
  it('never invents a placeholder host when no URL is configured', () => {
    const result = run('api GET /v1/records --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(JSON.stringify(parsed)).not.toContain('agledger.example.com');
    expect(parsed.auth.apiUrl).toBeNull();
  });

  it('names the error the real call would raise when no URL is configured', () => {
    const result = run('api GET /v1/records --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    const parsed = JSON.parse(result.stdout);
    expect(String(parsed.auth.apiUrlSource)).toContain('CONFIG_ERROR');
  });

  it('agrees with the real call: dry-run URL null iff the real call exits 2', () => {
    const dry = run('api GET /v1/records --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
    });
    const real = run('api GET /v1/records --json', { AGLEDGER_API_KEY: 'agl_adm_test' });
    expect(JSON.parse(dry.stdout).auth.apiUrl).toBeNull();
    expect(real.exitCode).toBe(2);
    expect(parseJson(real).code).toBe('CONFIG_ERROR');
  });

  it('names the error the real call would raise when the URL is unusable', () => {
    const dry = run('api GET /v1/records --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
      AGLEDGER_API_URL: 'not-a-url',
    });
    expect(dry.exitCode).toBe(0);
    expect(String(JSON.parse(dry.stdout).auth.apiUrlSource)).toContain('CONFIG_ERROR');
  });

  it('echoes the configured URL when one IS supplied', () => {
    const result = run('api GET /v1/records --dry-run --json', {
      AGLEDGER_API_KEY: 'agl_adm_test',
      AGLEDGER_API_URL: 'https://agledger.internal.example.com',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.auth.apiUrl).toBe('https://agledger.internal.example.com');
    expect(parsed.auth.apiUrlSource).toBeUndefined();
  });
});

describe('the API URL is checked before the credential', () => {
  it('with neither a URL nor a key, the missing URL is reported (exit 2 CONFIG_ERROR)', () => {
    const result = run('api GET /v1/records --json');
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('CONFIG_ERROR');
    expect(String(parsed.message)).toContain('No API URL configured');
  });

  // "Invalid URL" used to surface at request time as UNKNOWN_ERROR, exit 1.
  for (const [label, args, env] of [
    ['--api-url', '--api-url not-a-url', {}],
    ['AGLEDGER_API_URL', '', { AGLEDGER_API_URL: 'not-a-url' }],
    ['--api-url without a scheme', '--api-url localhost:3100', {}],
  ] as const) {
    it(`a malformed URL from ${label} is CONFIG_ERROR, exit 2, with or without a key`, () => {
      for (const key of ['', 'agl_adm_test']) {
        const result = run(`api GET /v1/records --json ${args}`, { ...env, AGLEDGER_API_KEY: key });
        expect(result.exitCode).toBe(2);
        const parsed = parseJson(result);
        expect(parsed.code).toBe('CONFIG_ERROR');
        expect(String(parsed.message)).toContain(`API URL from ${label.split(' ')[0]!}`);
      }
    });
  }

  it("a malformed URL stored on a profile is CONFIG_ERROR, exit 2, naming the profile", () => {
    const home = isolatedHome();
    const configDir = join(home, '.agledger');
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ profiles: { prod: { apiKey: 'agl_adm_k', apiUrl: 'not-a-url' } }, activeProfile: 'prod' }),
      { flag: 'w', mode: 0o600 },
    );
    const result = run('api GET /health --json', { HOME: home });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('CONFIG_ERROR');
    expect(String(parsed.message)).toContain("profile 'prod'");
    rmSync(home, { recursive: true, force: true });
  });

  it('login --oidc refuses a malformed URL before running the token source', () => {
    const home = isolatedHome();
    const result = run(`login --oidc --oidc-token-cmd 'exit 7' --api-url not-a-url --json`, { HOME: home });
    expect(result.exitCode).toBe(2);
    expect(parseJson(result).code).toBe('CONFIG_ERROR');
    rmSync(home, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OIDC token sources: precedence, stored sources, failures
// ---------------------------------------------------------------------------
describe('OIDC token sources', () => {
  const unreachable = 'http://127.0.0.1:45999';
  const JWT = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"sub":"agent-1"}').toString('base64url')}.c2ln`;
  const withProfile = (profiles: Record<string, unknown>): string => {
    const home = isolatedHome();
    mkdirSync(join(home, '.agledger'), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(home, '.agledger', 'config.json'),
      JSON.stringify({ profiles, activeProfile: Object.keys(profiles)[0] }),
      { mode: 0o600 },
    );
    return home;
  };

  it('AGLEDGER_OIDC_TOKEN_CMD is used when no API key is set, and --dry-run names it without running it', () => {
    const result = run(`api GET /v1/records --dry-run --json --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_CMD: 'exit 99',
    });
    expect(result.exitCode).toBe(0);
    const auth = JSON.parse(result.stdout).auth;
    expect(auth.credential).toBe('oidc-cert');
    expect(auth.oidcTokenSource).toBe('AGLEDGER_OIDC_TOKEN_CMD');
    expect(auth.source).toBe('env');
    expect(auth.apiKey).toBeNull();
  });

  it('an API key outranks both token sources', () => {
    const result = run(`api GET /v1/records --dry-run --json --api-url ${unreachable}`, {
      AGLEDGER_API_KEY: 'agl_agt_explicit',
      AGLEDGER_OIDC_TOKEN_CMD: 'exit 99',
      AGLEDGER_OIDC_TOKEN_FILE: '/tmp/x',
    });
    const auth = JSON.parse(result.stdout).auth;
    expect(auth.credential).toBe('api-key');
    expect(auth.apiKey).toBe('****icit');
  });

  it('the command outranks the file', () => {
    const result = run(`api GET /v1/records --dry-run --json --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_CMD: 'exit 99',
      AGLEDGER_OIDC_TOKEN_FILE: '/tmp/x',
    });
    expect(JSON.parse(result.stdout).auth.oidcTokenSource).toBe('AGLEDGER_OIDC_TOKEN_CMD');
    const fileOnly = run(`api GET /v1/records --dry-run --json --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_FILE: '/tmp/x',
    });
    expect(JSON.parse(fileOnly.stdout).auth.oidcTokenSource).toBe('AGLEDGER_OIDC_TOKEN_FILE');
  });

  it('an env token source outranks a stored profile key', () => {
    const home = withProfile({ default: { apiKey: 'agl_adm_stored', apiUrl: unreachable } });
    const result = run('api GET /v1/records --dry-run --json', { HOME: home, AGLEDGER_OIDC_TOKEN_FILE: '/tmp/x' });
    expect(JSON.parse(result.stdout).auth.credential).toBe('oidc-cert');
    rmSync(home, { recursive: true, force: true });
  });

  it('a profile stored by `login --oidc` resolves to its token source', () => {
    const home = withProfile({
      work: { apiUrl: unreachable, oidc: { tokenCommand: 'exit 99', agentId: 'a-1' } },
    });
    const result = run('api GET /v1/records --dry-run --json', { HOME: home });
    const auth = JSON.parse(result.stdout).auth;
    expect(auth.credential).toBe('oidc-cert');
    expect(auth.source).toBe('profile');
    expect(auth.oidcTokenSource).toBe("profile 'work' oidc.tokenCommand");
    const listed = JSON.parse(run('config list --json', { HOME: home }).stdout);
    expect(listed.profiles[0].credential).toBe('oidc-cert');
    rmSync(home, { recursive: true, force: true });
  });

  it('a failing token command exits 3 naming the variable and carrying its stderr', () => {
    const result = run(`api GET /v1/records --json --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_CMD: 'echo "idp unreachable" >&2; exit 4',
    });
    expect(result.exitCode).toBe(3);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('OIDC_TOKEN_SOURCE_FAILED');
    expect(parsed.message).toContain('AGLEDGER_OIDC_TOKEN_CMD');
    expect(parsed.message).toContain('idp unreachable');
  });

  it('an unreadable token file exits 3 naming the variable', () => {
    const result = run(`api GET /v1/records --json --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_FILE: '/nonexistent/agledger-token',
    });
    expect(result.exitCode).toBe(3);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('OIDC_TOKEN_SOURCE_FAILED');
    expect(parsed.message).toContain('AGLEDGER_OIDC_TOKEN_FILE');
  });

  it('--verbose names the source and never prints the token', () => {
    const result = run(`api GET /v1/records --json --verbose --api-url ${unreachable}`, {
      AGLEDGER_OIDC_TOKEN_CMD: `printf '%s' '${JWT}'`,
    });
    // The exchange cannot reach the Server, so the run fails; the diagnostics come first.
    const lines = result.stderr.split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ verbose: true, event: 'auth', credential: 'oidc-cert', source: 'AGLEDGER_OIDC_TOKEN_CMD' });
    expect(result.stderr).not.toContain(JWT);
    expect(result.stdout).not.toContain(JWT);
  });

  it('--verbose names an API key source without printing the key', () => {
    const result = run(`api GET /health --json --verbose --api-url ${unreachable}`, {
      AGLEDGER_API_KEY: 'agl_agt_verysecretvalue',
    });
    const first = JSON.parse(result.stderr.split('\n')[0]!);
    expect(first).toMatchObject({ event: 'auth', credential: 'api-key', source: 'AGLEDGER_API_KEY' });
    expect(result.stderr).not.toContain('verysecretvalue');
  });

  it('the no-credential error lists the API key and both token sources', () => {
    const parsed = parseJson(run(`api GET /v1/records --json --api-url ${unreachable}`));
    expect(parsed.code).toBe('AUTH_REQUIRED');
    for (const name of ['AGLEDGER_API_KEY', 'AGLEDGER_OIDC_TOKEN_CMD', 'AGLEDGER_OIDC_TOKEN_FILE']) {
      expect(parsed.suggestion).toContain(name);
    }
  });

  it('login --oidc without a token source fails before any request', () => {
    const home = isolatedHome();
    const result = run(`login --oidc --json --api-url ${unreachable}`, { HOME: home });
    expect(result.exitCode).toBe(3);
    expect(parseJson(result).suggestion).toContain('AGLEDGER_OIDC_TOKEN_CMD');
    rmSync(home, { recursive: true, force: true });
  });

  it('login --oidc refuses an API key alongside it', () => {
    const home = isolatedHome();
    const result = run(`login --oidc --json --api-url ${unreachable}`, {
      HOME: home,
      AGLEDGER_API_KEY: 'agl_agt_x',
      AGLEDGER_OIDC_TOKEN_CMD: 'exit 99',
    });
    expect(result.exitCode).toBe(2);
    rmSync(home, { recursive: true, force: true });
  });

  it('login --oidc with a token file saves without exchanging, so the token stays unspent', () => {
    const home = isolatedHome();
    const file = tmpJson('x');
    writeFileSync(file, `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"sub":"pod-a"}').toString('base64url')}.c2ln`);
    // The URL is unreachable: any exchange attempt would fail with NETWORK_ERROR.
    const result = run(`login --oidc --oidc-token-file ${file} --json --api-url ${unreachable}`, { HOME: home });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out).toMatchObject({ saved: true, verified: false, tokenSource: 'file', oidcSub: 'pod-a' });
    const cfg = JSON.parse(readFileSync(join(home, '.agledger', 'config.json'), 'utf8'));
    expect(cfg.profiles.default.oidc).toEqual({ tokenFile: file });
    rmSync(home, { recursive: true, force: true });
  });

  it('login --oidc stores nothing when the token source fails', () => {
    const home = isolatedHome();
    const result = run(`login --oidc --json --api-url ${unreachable}`, {
      HOME: home,
      AGLEDGER_OIDC_TOKEN_CMD: 'exit 5',
    });
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(run('config list --json', { HOME: home }).stdout).profiles).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// --paginate under OIDC: one client, one exchange, for every page
// ---------------------------------------------------------------------------
describe('--paginate with an OIDC token source', () => {
  it('exchanges once for the whole walk, as a token file requires', async () => {
    const { createServer } = await import('node:http');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    let exchanges = 0;
    const bearers: string[] = [];
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/auth/oidc/cert') {
        exchanges += 1;
        // The real Server refuses a token id it has already exchanged.
        if (exchanges > 1) {
          res.statusCode = 409;
          res.end(JSON.stringify({ detail: 'This OIDC token id has already been exchanged' }));
          return;
        }
        const t = Date.now();
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            certJws: 'cert-1',
            cert: { id: 'c1', issuedAt: new Date(t).toISOString(), expiresAt: new Date(t + 600_000).toISOString() },
          }),
        );
        return;
      }
      bearers.push(String(req.headers.authorization));
      const page = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('cursor') ?? '0');
      res.end(JSON.stringify({ data: [{ n: page }], hasMore: page < 2, nextCursor: String(page + 1) }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const file = tmpJson('x');
    writeFileSync(
      file,
      `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"sub":"a"}').toString('base64url')}.c2ln`,
    );
    try {
      const { stdout } = await promisify(execFile)('node', [BIN, 'api', 'GET', '/v1/records', '--paginate', '--json'], {
        env: {
          ...process.env,
          AGLEDGER_API_KEY: '',
          AGLEDGER_OIDC_TOKEN_CMD: '',
          AGLEDGER_ON_BEHALF_OF_CMD: '',
          AGLEDGER_ON_BEHALF_OF_FILE: '',
          AGLEDGER_API_URL: `http://127.0.0.1:${port}`,
          AGLEDGER_OIDC_TOKEN_FILE: file,
          HOME: isolatedHome(),
        },
      });
      expect(stdout.trim().split('\n').map((l) => JSON.parse(l).n)).toEqual([0, 1, 2]);
      expect(exchanges).toBe(1);
      expect(bearers).toEqual(['Bearer cert-1', 'Bearer cert-1', 'Bearer cert-1']);
    } finally {
      server.close();
    }
  });
});

describe('a refused OIDC cert exchange reaches the user', () => {
  it('AGLEDGER_OIDC_AGENT_ID is sent as an assertion, and a 403 CERT_AGENT_BINDING_MISMATCH forwards its recoveryHint and exits 4', async () => {
    const { createServer } = await import('node:http');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const recoveryHint =
      'Bind the agent to this identity, then retry with agentId omitted (or equal to that agent). ' +
      'PATCH /v1/agents/agent-2 with { "oidcIss": "https://idp.example", "oidcSub": "<the sub in your token>" }';
    let sentAgentId: unknown;
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d: Buffer) => (raw += d.toString('utf8')));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/auth/oidc/cert') {
          sentAgentId = (JSON.parse(raw) as { agentId?: unknown }).agentId;
          res.statusCode = 403;
          res.end(
            JSON.stringify({
              type: '/problems/forbidden',
              title: 'Forbidden',
              status: 403,
              detail: 'The body names agent agent-2, but this token binds to no agent.',
              error: 'CERT_AGENT_BINDING_MISMATCH',
              recoveryHint,
              retryable: false,
            }),
          );
          return;
        }
        res.statusCode = 500;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const jwt = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"sub":"a"}').toString('base64url')}.c2ln`;
    try {
      const failed = (await promisify(execFile)('node', [BIN, 'api', 'GET', '/v1/auth/me', '--json'], {
        env: {
          ...process.env,
          AGLEDGER_API_KEY: '',
          AGLEDGER_OIDC_TOKEN_FILE: '',
          AGLEDGER_ON_BEHALF_OF_CMD: '',
          AGLEDGER_ON_BEHALF_OF_FILE: '',
          AGLEDGER_API_URL: `http://127.0.0.1:${port}`,
          AGLEDGER_OIDC_TOKEN_CMD: `printf '%s' '${jwt}'`,
          AGLEDGER_OIDC_AGENT_ID: 'agent-2',
          HOME: isolatedHome(),
        },
      }).catch((e: unknown) => e)) as { code?: number; stderr?: string };
      expect(sentAgentId).toBe('agent-2');
      expect(failed.code).toBe(4);
      const err = JSON.parse(String(failed.stderr).trim().split('\n').at(-1) ?? '{}');
      expect(err.code).toBe('OIDC_EXCHANGE_FAILED');
      expect(err.status).toBe(403);
      expect(err.message).toContain('this token binds to no agent');
      expect(err.apiError.error).toBe('CERT_AGENT_BINDING_MISMATCH');
      expect(err.apiError.recoveryHint).toBe(recoveryHint);
      expect(String(failed.stderr)).not.toContain(jwt);
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// A write that outlives the client timeout
// ---------------------------------------------------------------------------
describe('agledger api: a timed-out write carries its Idempotency-Key', () => {
  /** Async, so a server in this process can answer while the CLI runs. */
  const runAsync = (args: string[], env: Record<string, string>) =>
    new Promise<{ stdout: string; stderr: string; exitCode: number }>((done) => {
      execFile(
        'node',
        [BIN, ...args],
        { env: { ...process.env, AGLEDGER_API_KEY: 'agl_agt_t', HOME: tmpdir(), ...env }, timeout: SPAWN_TIMEOUT },
        (err, stdout, stderr) => {
          const code = (err as { code?: number } | null)?.code;
          done({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: err ? (typeof code === 'number' ? code : 1) : 0 });
        },
      );
    });

  /** Holds the first POST past the CLI's timeout; answers a repeat of its key from the first. */
  const startServer = async () => {
    const seen = new Map<string, string>();
    const keys: Array<string | undefined> = [];
    const server: Server = createServer((req: IncomingMessage, res) => {
      const key = req.headers['idempotency-key'] as string | undefined;
      keys.push(key);
      if (req.method === 'POST' && key) {
        const existing = seen.get(key);
        if (existing === undefined) {
          seen.set(key, `rec-${seen.size + 1}`);
          return; // hold: the client times out first
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: existing }));
        return;
      }
      // Held GETs too, to prove a read claims no key.
      if (req.url === '/slow') return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { server, url, keys, seen };
  };

  it('names the key on TIMEOUT, and rerunning with it replays instead of duplicating', async () => {
    const { server, url, keys, seen } = await startServer();
    try {
      const env = { AGLEDGER_API_URL: url, AGLEDGER_TIMEOUT: '0.4' };
      const first = await runAsync(['api', 'POST', '/v1/records', '-F', 'type=x', '--json'], env);
      expect(first.exitCode).toBe(10);
      const err = JSON.parse(first.stderr.split('\n')[0]);
      expect(err.code).toBe('TIMEOUT');
      expect(err.idempotencyKey).toBe(keys[0]);
      expect(err.suggestion).toContain(`--idempotency-key ${err.idempotencyKey}`);
      expect(err.suggestion).not.toContain('Retry the same command.');
      expect(err.suggestion).toContain('AGLEDGER_TIMEOUT');

      const second = await runAsync(
        ['api', 'POST', '/v1/records', '-F', 'type=x', '--idempotency-key', err.idempotencyKey, '--json'],
        env,
      );
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(second.stdout)).toEqual({ id: 'rec-1' });
      expect(seen.size).toBe(1);
    } finally {
      server.close();
    }
  });

  it('AGLEDGER_TIMEOUT must be a positive number of seconds, or the call exits 2 CONFIG_ERROR', async () => {
    for (const bad of ['0', '-5', 'abc', '', '2147484']) {
      const result = await runAsync(['api', 'GET', '/health', '--json'], { AGLEDGER_API_URL: 'http://127.0.0.1:1', AGLEDGER_TIMEOUT: bad });
      expect(result.exitCode, bad).toBe(2);
      const err = JSON.parse(result.stderr.split('\n')[0]);
      expect(err.code).toBe('CONFIG_ERROR');
      expect(err.message).toContain('AGLEDGER_TIMEOUT');
    }
  });

  it('a timed-out GET claims no key', async () => {
    const { server, url } = await startServer();
    try {
      const result = await runAsync(['api', 'GET', '/slow', '--json'], {
        AGLEDGER_API_URL: url,
        AGLEDGER_TIMEOUT: '0.4',
      });
      expect(result.exitCode).toBe(10);
      const err = JSON.parse(result.stderr.split('\n')[0]);
      expect(err.code).toBe('TIMEOUT');
      expect(err).not.toHaveProperty('idempotencyKey');
      expect(err.suggestion).not.toContain('idempotency');
    } finally {
      server.close();
    }
  });

  it('--verbose shows the key a POST is sent under, and none for a GET', async () => {
    const { server, url } = await startServer();
    try {
      const env = { AGLEDGER_API_URL: url, AGLEDGER_TIMEOUT: '0.4' };
      const post = await runAsync(['api', 'POST', '/v1/records', '--verbose', '--idempotency-key', 'my-key', '--json'], env);
      const lines = post.stderr.split('\n').map((l) => JSON.parse(l));
      expect(lines.find((l) => l.event === 'request')).toMatchObject({ method: 'POST', idempotencyKey: 'my-key' });
      const get = await runAsync(['api', 'GET', '/health', '--verbose', '--json'], env);
      expect(get.stderr).not.toContain('idempotencyKey');
    } finally {
      server.close();
    }
  });

  it('a connection dropped after the request went out carries the key too', async () => {
    const server = createServer((req) => req.socket.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const result = await runAsync(['api', 'POST', '/v1/records', '--json'], { AGLEDGER_API_URL: url });
      expect(result.exitCode).toBe(9);
      const err = JSON.parse(result.stderr.split('\n')[0]);
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.suggestion).toContain(`--idempotency-key ${err.idempotencyKey}`);
    } finally {
      server.close();
    }
  });

  it('a refused connection never sent anything, so it names no key', async () => {
    // A port that was just listening and is not now. (Port 9 is on fetch's blocked list, which fails differently.)
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise((r) => probe.close(r));
    const result = await runAsync(['api', 'POST', '/v1/records', '--json'], { AGLEDGER_API_URL: `http://127.0.0.1:${port}` });
    const err = JSON.parse(result.stderr.split('\n')[0]);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err).not.toHaveProperty('idempotencyKey');
  });
});

describe('verify flagWording', () => {
  it.each([
    ['If the operator confirms it, give distrustedKeys sha256:ab@x.', 'If the operator confirms it, give --distrusted-key sha256:ab@x.'],
    ['distrustedKeys gives k the instant t', '--distrusted-key gives k the instant t'],
    [`if k leaked as well, add sha256:${'c'.repeat(64)} to distrustedKeys too.`, `if k leaked as well, add --distrusted-key sha256:${'c'.repeat(64)} too.`],
    ['k is in distrustedKeys, and this closure still counts', 'k is given as a --distrusted-key, and this closure still counts'],
    ['If k is honest, pin sha256:e in trustAnchors (VAULT_TRUST_ANCHORS on the Server)', 'If k is honest, pin sha256:e with --trust-anchor (VAULT_TRUST_ANCHORS on the Server)'],
    ['No trustAnchors were given, so ... (sha256:<hex>) as trustAnchors.', 'No --trust-anchor was given, so ... (sha256:<hex>) as --trust-anchor.'],
    ['(requireKeyId, or requireSuppliedKeys refusing a key)', '(--require-key-id, or --require-supplied-keys refusing a key)'],
    ['distrustedFrom and VAULT_DISTRUSTED_KEYS stay as they are', 'distrustedFrom and VAULT_DISTRUSTED_KEYS stay as they are'],
  ])('%s', (from, to) => {
    expect(flagWording(from)).toBe(to);
  });
});
