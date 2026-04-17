/**
 * AGLedger CLI v0.5.0 — Thin-cover integration tests.
 *
 * The CLI is a pass-through over the API. These tests validate:
 *  - Surface: list-commands + help-json report the 8 CLI-local commands
 *  - `agledger api`: method/path validation, --data/--input/-F/--query merging,
 *    --dry-run, --paginate, auth enforcement, error passthrough
 *  - `discover`, `login`, `auth`, `logout`, `config`: CLI-local behaviors
 *  - Exit codes, --quiet, --json, NO_COLOR
 *
 * No real API calls — all paths that would hit the network either dry-run or
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
// Discovery — the whole CLI surface
// ---------------------------------------------------------------------------
describe('command surface', () => {
  it('list-commands returns 8 CLI-local commands', () => {
    const result = run('list-commands --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.commands).toBeInstanceOf(Array);
    expect(parsed.commands).toHaveLength(8);
    const names = parsed.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['api', 'discover', 'login', 'logout', 'auth', 'config', 'list-commands', 'help-json']),
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
// `agledger api` — the main event
// ---------------------------------------------------------------------------
describe('agledger api: method + path validation', () => {
  it('rejects unknown method', () => {
    const result = run('api FROGGY /v1/mandates --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_METHOD');
  });

  it('rejects path without leading /', () => {
    const result = run('api GET v1/mandates --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_PATH');
  });

  it('normalizes lowercase method', () => {
    const result = run('api get /v1/mandates --dry-run --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.method).toBe('GET');
  });

  it('requires auth', () => {
    const result = run('api GET /v1/mandates --json');
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('AUTH_REQUIRED');
  });

  it('does NOT auto-prefix /v1/ — health path passes through', () => {
    const result = run('api GET /health --dry-run --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.path).toBe('/health');
  });

  it('does NOT auto-prefix /v1/ — caller keeps /v1/ explicit', () => {
    const result = run('api GET /v1/mandates --dry-run --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.path).toBe('/v1/mandates');
  });
});

describe('agledger api: --data body handling', () => {
  it('accepts --data as JSON body on POST', () => {
    const result = run(
      'api POST /v1/mandates --data \'{"contractType":"ACH-PROC-v1"}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ contractType: 'ACH-PROC-v1' });
  });

  it('routes --data to query for GET', () => {
    const result = run(
      'api GET /v1/mandates --data \'{"status":"ACTIVE","limit":10}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.query).toEqual({ status: 'ACTIVE', limit: 10 });
    expect(parsed.body).toBeUndefined();
  });

  it('rejects invalid --data JSON with structured error', () => {
    const result = run('api POST /v1/mandates --data \'{not-json}\' --dry-run --json', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_JSON_INPUT');
    expect(parsed.message).toContain('--data');
  });
});

describe('agledger api: --input file and stdin', () => {
  it('reads JSON body from --input file', () => {
    const file = tmpJson({ contractType: 'ACH-DATA-v1', criteria: { x: 1 } });
    const result = run(`api POST /v1/mandates --input ${file} --dry-run --json`, {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ contractType: 'ACH-DATA-v1', criteria: { x: 1 } });
  });

  it('returns FILE_READ_ERROR for missing --input path', () => {
    const result = run('api POST /v1/mandates --input /no/such/file --dry-run --json', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('FILE_READ_ERROR');
  });

  it('reads from stdin when --input is -', () => {
    const stdout = execSync(
      `node ${BIN} api POST /v1/mandates --input - --dry-run --json`,
      {
        encoding: 'utf-8',
        env: { ...process.env, AGLEDGER_API_KEY: 'ach_ent_test', AGLEDGER_API_URL: '', HOME: tmpdir() },
        input: '{"contractType":"ACH-ORCH-v1"}',
        timeout: 10_000,
      },
    );
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.body).toEqual({ contractType: 'ACH-ORCH-v1' });
  });
});

describe('agledger api: -F/--field typed parsing', () => {
  it('treats bare values as strings', () => {
    const result = run('api POST /v1/x -F name=Alice --dry-run --json', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ name: 'Alice' });
  });

  it('parses booleans, null, numbers', () => {
    const result = run(
      'api POST /v1/x -F active=true -F disabled=false -F middle=null -F count=42 -F ratio=0.5 --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ active: true, disabled: false, middle: null, count: 42, ratio: 0.5 });
  });

  it('parses nested paths with dot syntax', () => {
    const result = run(
      'api POST /v1/x -F criteria.item_spec=widgets -F criteria.quantity.target=500 --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ criteria: { item_spec: 'widgets', quantity: { target: 500 } } });
  });

  it('appends to arrays with [] syntax', () => {
    const result = run(
      'api POST /v1/webhooks -F url=https://example.com -F eventTypes[]=a -F eventTypes[]=b --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ url: 'https://example.com', eventTypes: ['a', 'b'] });
  });

  it('parses JSON literals for bracketed values', () => {
    // Single-quote the JSON literals so the shell passes them through verbatim.
    const result = run(
      `api POST /v1/x -F 'obj={"k":"v"}' -F 'arr=[1,2,3]' --dry-run --json`,
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ obj: { k: 'v' }, arr: [1, 2, 3] });
  });

  it('returns INVALID_FIELD on missing =', () => {
    const result = run('api POST /v1/x -F broken --json', { AGLEDGER_API_KEY: 'ach_ent_test' });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_FIELD');
  });
});

describe('agledger api: body-source merging', () => {
  it('merges --data then -F (later wins)', () => {
    const result = run(
      'api POST /v1/x --data \'{"a":1,"b":2}\' -F b=99 -F c=3 --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.body).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('--query overrides body for GET', () => {
    const result = run(
      'api GET /v1/mandates -F status=ACTIVE --query \'{"limit":5}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.query).toEqual({ status: 'ACTIVE', limit: 5 });
  });
});

describe('agledger api: --paginate', () => {
  it('--paginate rejected on non-GET', () => {
    const result = run('api POST /v1/mandates --paginate --json', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('INVALID_METHOD');
  });

  it('--paginate --dry-run shows the stream intent', () => {
    const result = run('api GET /v1/mandates -F limit=50 --paginate --dry-run --json', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.paginate).toBe(true);
    expect(parsed.query).toEqual({ limit: 50 });
  });
});

describe('agledger api: --dry-run + --quiet', () => {
  it('--dry-run --quiet produces no output with exit 0', () => {
    const result = run('api POST /v1/mandates --data \'{"x":1}\' --dry-run --quiet', {
      AGLEDGER_API_KEY: 'ach_ent_test',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
// discover / auth
// ---------------------------------------------------------------------------
describe('discover + auth', () => {
  it('discover requires auth', () => {
    const result = run('discover --json');
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('AUTH_REQUIRED');
  });

  it('auth with no key returns authenticated:false and exits 0', () => {
    const result = run('auth --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.authenticated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// login + logout + config — CLI-local
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
    const result = run('api GET /v1/mandates --json');
    const parsed = parseJson(result);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('AUTH_REQUIRED');
    expect(parsed.message).toBeDefined();
  });
});
