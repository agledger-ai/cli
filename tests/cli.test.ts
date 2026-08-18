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
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../bin/run.js');

/** Run a CLI command, capturing stdout/stderr and exit code. */
const run = (args: string, env?: Record<string, string>) => {
  try {
    return {
      stdout: execSync(`node ${BIN} ${args}`, {
        encoding: 'utf-8',
        env: { ...process.env, AGLEDGER_API_KEY: '', AGLEDGER_API_URL: '', HOME: tmpdir(), ...env },
        timeout: 10_000,
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
    const result = run('api GET /v1/records --json');
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
        timeout: 10_000,
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

  it('logout on non-existent profile reports nothing removed', () => {
    const home = isolatedHome();
    const result = run('logout --profile ghost --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loggedOut).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  it('logout --all on empty config returns empty removedProfiles', () => {
    const home = isolatedHome();
    const result = run('logout --all --json', { HOME: home });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loggedOut).toBe(true);
    expect(parsed.removedProfiles).toEqual([]);
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
    const result = run('api GET /v1/records --json');
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
        `verify ${VECTORS}/valid.json --keys ${keysFile} --require-out-of-band-keys --json`,
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

  it('usage error exit 2 on missing file arg', () => {
    const result = run('verify --json');
    expect(result.exitCode).toBe(2);
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
    options?: { keysFile?: string; requireKeyId?: string; requireOutOfBandKeys?: boolean };
  }
  const manifest = JSON.parse(
    readFileSync(join(CONFORMANCE, 'manifest-export.json'), 'utf-8'),
  ) as { vectors: ManifestVector[] };

  for (const vector of manifest.vectors) {
    const label =
      vector.expect === 'pass'
        ? `${vector.file} -> pass`
        : `${vector.file} -> fail (${vector.failureCode})`;
    it(label, () => {
      let flags = vector.options?.keysFile
        ? ` --keys ${join(CONFORMANCE, vector.options.keysFile)}`
        : '';
      if (vector.options?.requireKeyId) flags += ` --require-key-id ${vector.options.requireKeyId}`;
      if (vector.options?.requireOutOfBandKeys) flags += ' --require-out-of-band-keys';
      const result = run(`verify ${join(CONFORMANCE, vector.file)}${flags} --json`);
      const parsed = JSON.parse(result.stdout) as {
        valid: boolean;
        brokenAt?: { code: string; position: number };
      };
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
