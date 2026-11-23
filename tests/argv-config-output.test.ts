/**
 * Command-line dispatch, the profile store, and what `agledger api` does with
 * its output path, query and pagination. The unit tests call the parser and
 * the field parser directly; the rest spawn the built CLI against a local
 * server, with HOME pointed at a throwaway directory.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allFlags } from '../src/cli/command.js';
import { parse } from '../src/cli/parse.js';
import { queryParams } from '../src/api-client.js';
import { parseFields } from '../src/util/field-parser.js';
import Api from '../src/commands/api.js';

const BIN = resolve(import.meta.dirname, '../bin/run.js');
const SPAWN_TIMEOUT = 60_000;

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const cli = (args: string[], home: string, env: Record<string, string> = {}): Promise<Result> =>
  new Promise((done) => {
    execFile(
      'node',
      [BIN, ...args],
      {
        env: {
          ...process.env,
          AGLEDGER_API_KEY: '',
          AGLEDGER_API_URL: '',
          AGLEDGER_OIDC_TOKEN_CMD: '',
          AGLEDGER_OIDC_TOKEN_FILE: '',
          AGLEDGER_ON_BEHALF_OF_CMD: '',
          AGLEDGER_ON_BEHALF_OF_FILE: '',
          HOME: home,
          ...env,
        },
        timeout: SPAWN_TIMEOUT,
      },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code;
        done({ stdout, stderr, exitCode: err ? (typeof code === 'number' ? code : 1) : 0 });
      },
    );
  });

const errorOf = (result: Result): Record<string, unknown> => JSON.parse(result.stderr.split('\n')[0] ?? '{}');
const home = (): string => mkdtempSync(join(tmpdir(), 'cli-argv-'));

/** A server that records what it was asked and answers `reply`. */
async function withServer(
  reply: (req: { method: string; url: string }) => unknown,
  fn: (url: string, seen: Array<{ method: string; url: string }>) => Promise<void>,
): Promise<void> {
  const seen: Array<{ method: string; url: string }> = [];
  const server: Server = createServer((req, res) => {
    const entry = { method: req.method ?? '', url: req.url ?? '' };
    seen.push(entry);
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(reply(entry)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`, seen);
  } finally {
    server.close();
  }
}

describe('the -F/-f run in the parser', () => {
  const parseApi = (argv: string[]) => parse(argv, Api.args ?? {}, allFlags(Api));

  it('leaves the positionals that follow a field as positionals', () => {
    const { args, flags } = parseApi(['-F', 'a=1', 'GET', '/health']);
    expect(args).toEqual({ method: 'GET', path: '/health' });
    expect(flags.field).toEqual(['a=1']);
  });

  it('takes further KEY=VALUE words as fields, as before', () => {
    const { args, flags } = parseApi(['GET', '/v1/records', '-F', 'a=1', 'b=2', 'c.d=3']);
    expect(args.path).toBe('/v1/records');
    expect(flags.field).toEqual(['a=1', 'b=2', 'c.d=3']);
  });

  it('ends the run at a boolean flag', () => {
    expect(() => parseApi(['POST', '/x', '-F', 'a=1', '--dry-run', 'b=2'])).toThrow(/Unexpected argument: b=2/);
  });

  it('ends the run at a word that is not KEY=VALUE', () => {
    expect(() => parseApi(['-F', 'a=1', 'GET', 'b=2', '/x'])).toThrow(/Unexpected argument/);
  });
});

describe('-F number coercion', () => {
  it('types a number only when it prints back as typed', () => {
    expect(parseFields(['a=42', 'b=3.14', 'c=-7'])).toEqual({ a: 42, b: 3.14, c: -7 });
  });

  it('keeps a leading-zero id, a negative zero and an integer past 2^53 as strings', () => {
    expect(parseFields(['a=0123', 'b=-0', 'c=12345678901234567890', 'd=1.0'])).toEqual({
      a: '0123',
      b: '-0',
      c: '12345678901234567890',
      d: '1.0',
    });
  });
});

describe('a query with no wire form', () => {
  it('refuses null and a non-object, and serializes the rest', () => {
    expect(() => queryParams({ status: null })).toThrow(/null has no query-string form/);
    expect(() => queryParams([1, 2])).toThrow(/must be a JSON object/);
    expect(queryParams({ a: 1, b: ['x', 'y'], c: { d: 'e' } }).toString()).toBe('a=1&b=x&b=y&c%5Bd%5D=e');
  });
});

describe('global flags before the command, and help', () => {
  it('dispatches --json and --quiet written before the command', async () => {
    const h = home();
    await withServer(() => ({ ok: true }), async (url) => {
      const json = await cli(['--json', 'api', 'GET', '/health', '--api-url', url], h);
      expect(json.exitCode).toBe(0);
      expect(JSON.parse(json.stdout)).toEqual({ ok: true });
      const quiet = await cli(['--quiet', 'api', 'GET', '/health', '--api-url', url], h);
      expect(quiet.exitCode).toBe(0);
      expect(quiet.stdout).toBe('');
    });
    rmSync(h, { recursive: true, force: true });
  });

  it('prints help for -h and for `help <command>`, and refuses `help nope`', async () => {
    const h = home();
    const short = await cli(['api', '-h'], h);
    expect(short.exitCode).toBe(0);
    expect(short.stdout).toContain('USAGE');
    const word = await cli(['help', 'api'], h);
    expect(word.stdout).toBe(short.stdout);
    expect((await cli(['help'], h)).stdout).toContain('COMMANDS');
    const missing = await cli(['help', 'nope'], h);
    expect(missing.exitCode).toBe(2);
    expect(errorOf(missing).code).toBe('COMMAND_NOT_FOUND');
    rmSync(h, { recursive: true, force: true });
  });

  it('does not read --help as help when it is a flag value or follows --', async () => {
    const h = home();
    const value = await cli(['api', 'POST', '/v1/x', '--data', '--help'], h, { AGLEDGER_API_URL: 'http://127.0.0.1:1', AGLEDGER_API_KEY: 'k' });
    expect(value.exitCode).toBe(2);
    expect(errorOf(value).code).toBe('INVALID_JSON_INPUT');
    const after = await cli(['api', '--', '--help'], h);
    expect(after.stdout).not.toContain('USAGE');
    rmSync(h, { recursive: true, force: true });
  });

  it('keeps the credential flags out of --help on a command that makes no API call', async () => {
    const h = home();
    const help = await cli(['list-commands', '--help'], h);
    expect(help.stdout).not.toContain('--api-key');
    expect(help.stdout).toContain('--json');
    rmSync(h, { recursive: true, force: true });
  });
});

describe('the profile store', () => {
  it('refuses a corrupt config file and leaves it as it was', async () => {
    const h = home();
    mkdirSync(join(h, '.agledger'));
    const path = join(h, '.agledger', 'config.json');
    writeFileSync(path, '{"profiles": {"prod": {"apiKey": "keep-me"');
    const before = readFileSync(path, 'utf-8');
    const login = await cli(['login', '--api-key', 'k', '--api-url', 'http://127.0.0.1:1'], h);
    expect(login.exitCode).toBe(2);
    expect(errorOf(login).code).toBe('CONFIG_ERROR');
    expect(readFileSync(path, 'utf-8')).toBe(before);
    expect((await cli(['config', 'list'], h)).exitCode).toBe(2);
    expect((await cli(['config', 'path'], h)).exitCode).toBe(0);
    rmSync(h, { recursive: true, force: true });
  });

  it('writes the file 0600 and tightens a config directory that already exists', async () => {
    const h = home();
    mkdirSync(join(h, '.agledger'));
    chmodSync(join(h, '.agledger'), 0o755);
    await withServer(() => ({ role: 'agent' }), async (url) => {
      const login = await cli(['login', '--api-key', 'k', '--api-url', url], h);
      expect(login.exitCode).toBe(0);
    });
    expect(statSync(join(h, '.agledger')).mode & 0o777).toBe(0o700);
    expect(statSync(join(h, '.agledger', 'config.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(h, '.agledger', `.config.json.${process.pid}.tmp`))).toBe(false);
    rmSync(h, { recursive: true, force: true });
  });

  it('keeps the stored apiUrl when a key is replaced without --api-url', async () => {
    const h = home();
    await withServer(() => ({ role: 'agent' }), async (url) => {
      await cli(['login', '--api-key', 'old', '--api-url', url, '--profile', 'prod'], h);
      const again = await cli(['login', '--api-key', 'new', '--profile', 'prod'], h);
      expect(again.exitCode).toBe(0);
      const config = JSON.parse(readFileSync(join(h, '.agledger', 'config.json'), 'utf-8'));
      expect(config.profiles.prod).toEqual({ apiKey: 'new', apiUrl: url });
    });
    rmSync(h, { recursive: true, force: true });
  });

  it('does not resolve a profile through Object.prototype', async () => {
    const h = home();
    for (const name of ['toString', '__proto__', 'constructor']) {
      const result = await cli(['config', 'get', '--profile', name], h);
      expect(result.exitCode, name).toBe(2);
      expect(errorOf(result).message).toContain('not found');
    }
    rmSync(h, { recursive: true, force: true });
  });
});

describe('agledger api: --paginate', () => {
  it('errors when the response is not a paginated list', async () => {
    const h = home();
    await withServer(() => ({ id: 'one-object' }), async (url) => {
      const result = await cli(['api', 'GET', '/v1/records/x', '--paginate', '--api-url', url, '--api-key', 'k'], h);
      expect(result.exitCode).toBe(2);
      expect(errorOf(result).code).toBe('NOT_PAGINATED');
      expect(result.stdout).toBe('');
    });
    rmSync(h, { recursive: true, force: true });
  });

  it('refuses --output, before any request', async () => {
    const h = home();
    await withServer(() => ({ data: [] }), async (url, seen) => {
      const result = await cli(['api', 'GET', '/v1/records', '--paginate', '--output', join(h, 'o'), '--api-url', url, '--api-key', 'k'], h);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('--output');
      expect(errorOf(result).code).toBe('INVALID_FIELD');
      expect(seen).toHaveLength(0);
    });
    rmSync(h, { recursive: true, force: true });
  });

  it('ends quietly with code 0 when the reader closes the pipe', async () => {
    const h = home();
    const data = Array.from({ length: 30_000 }, (_, i) => ({ id: i, pad: 'x'.repeat(60) }));
    await withServer(() => ({ data, hasMore: false }), async (url) => {
      const result = await new Promise<Result>((done) => {
        execFile(
          'bash',
          ['-c', `node "${BIN}" api GET /v1/records --paginate --api-url "${url}" --api-key k 2>"${h}/err" | head -1 >/dev/null; echo "\${PIPESTATUS[0]}"`],
          { env: { ...process.env, HOME: h }, timeout: SPAWN_TIMEOUT },
          (_err, stdout) => done({ stdout: stdout.trim(), stderr: readFileSync(join(h, 'err'), 'utf-8'), exitCode: 0 }),
        );
      });
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('0');
    });
    rmSync(h, { recursive: true, force: true });
  });
});

describe('agledger api: --output', () => {
  it('refuses an unwritable path before the request is sent', async () => {
    const h = home();
    await withServer(() => ({ id: 'rec-1' }), async (url, seen) => {
      const result = await cli(
        ['api', 'POST', '/v1/records', '-F', 'type=x', '--output', join(h, 'no-such-dir', 'out.json'), '--api-url', url, '--api-key', 'k'],
        h,
      );
      expect(result.exitCode).toBe(2);
      expect(errorOf(result).code).toBe('FILE_WRITE_ERROR');
      expect(seen).toHaveLength(0);
    });
    rmSync(h, { recursive: true, force: true });
  });

  it('rejects an empty path and a directory', async () => {
    const h = home();
    for (const out of ['', h]) {
      const result = await cli(['api', 'GET', '/health', `--output=${out}`, '--api-url', 'http://127.0.0.1:1', '--api-key', 'k'], h);
      expect(result.exitCode, out).toBe(2);
      expect(errorOf(result).code).toBe('FILE_WRITE_ERROR');
    }
    rmSync(h, { recursive: true, force: true });
  });

  it('prints the body and the idempotency key when the write fails after the request went out', async () => {
    const h = home();
    const out = join(h, 'out.json');
    writeFileSync(out, '');
    await withServer(
      () => {
        // The file was writable when the CLI checked; make it unwritable before it writes.
        chmodSync(out, 0o400);
        return { id: 'rec-1' };
      },
      async (url) => {
        const result = await cli(
          ['api', 'POST', '/v1/records', '-F', 'type=x', '--output', out, '--idempotency-key', 'key-123', '--api-url', url, '--api-key', 'k'],
          h,
        );
        if (process.getuid?.() === 0) return; // root writes through a read-only file
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({ id: 'rec-1' });
        const err = errorOf(result);
        expect(err.code).toBe('FILE_WRITE_ERROR');
        expect(err.idempotencyKey).toBe('key-123');
      },
    );
    rmSync(h, { recursive: true, force: true });
  });
});

describe('agledger api: the request that is sent is the request that is shown', () => {
  it('refuses a null query value and a non-object query, dry run included', async () => {
    const h = home();
    const base = ['--api-url', 'http://127.0.0.1:1', '--api-key', 'k'];
    for (const args of [
      ['api', 'GET', '/v1/records', '-F', 'status=null', '--dry-run'],
      ['api', 'GET', '/v1/records', '-F', 'status=null'],
      ['api', 'GET', '/v1/records', '--data', '[1,2]', '--dry-run'],
      ['api', 'DELETE', '/v1/records/x', '--data', '[1,2]'],
    ]) {
      const result = await cli([...args, ...base], h);
      expect(result.exitCode, args.join(' ')).toBe(2);
      expect(errorOf(result).code).toBe('INVALID_FIELD');
    }
    rmSync(h, { recursive: true, force: true });
  });

  it('keeps a body null on POST, where it is sent', async () => {
    const h = home();
    const result = await cli(['api', 'POST', '/v1/records', '-F', 'x=null', '--dry-run', '--api-url', 'http://127.0.0.1:1', '--api-key', 'k'], h);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).body).toEqual({ x: null });
    rmSync(h, { recursive: true, force: true });
  });
});

describe('credentials in the API URL', () => {
  it('are refused without echoing the password', async () => {
    const h = home();
    const result = await cli(['api', 'GET', '/health', '--api-url', 'http://user:s3cret@127.0.0.1:1'], h);
    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe('CONFIG_ERROR');
    expect(result.stderr).not.toContain('s3cret');
    const dry = await cli(['api', 'GET', '/health', '--dry-run', '--api-url', 'http://user:s3cret@127.0.0.1:1'], h);
    expect(dry.stdout + dry.stderr).not.toContain('s3cret');
    rmSync(h, { recursive: true, force: true });
  });
});

describe('--idempotency-key', () => {
  it('is a usage error when it has a newline or is past 256 characters', async () => {
    const h = home();
    for (const key of ['a\nb', 'x'.repeat(257), '']) {
      const result = await cli(
        ['api', 'POST', '/v1/records', '-F', 'a=1', `--idempotency-key=${key}`, '--api-url', 'http://127.0.0.1:1', '--api-key', 'k'],
        h,
      );
      expect(result.exitCode, JSON.stringify(key.slice(0, 5))).toBe(2);
      expect(errorOf(result).message).toContain('--idempotency-key');
      expect(errorOf(result).code).toBe('INVALID_FIELD');
    }
    const ok = await cli(
      ['api', 'POST', '/v1/records', '-F', 'a=1', `--idempotency-key=${'x'.repeat(256)}`, '--dry-run', '--api-url', 'http://127.0.0.1:1', '--api-key', 'k'],
      h,
    );
    expect(ok.exitCode).toBe(0);
    rmSync(h, { recursive: true, force: true });
  });
});

describe('the exit code for each API error status, as the README documents', () => {
  it.each([
    [400, 1],
    [401, 3],
    [403, 4],
    [404, 5],
    [409, 6],
    [429, 7],
    [500, 8],
    [503, 8],
  ])('HTTP %i exits %i and passes the Server body through', async (status, code) => {
    const h = home();
    const server: Server = createServer((req, res) => {
      req.resume();
      res.statusCode = status;
      // No Retry-After, so a 429 or 5xx is not waited on.
      res.setHeader('content-type', 'application/problem+json');
      res.end(JSON.stringify({ status, error: 'SOME_CODE', detail: `status ${status}` }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as { port: number };
      const result = await cli(['api', 'GET', '/v1/records', '--api-url', `http://127.0.0.1:${port}`, '--api-key', 'k'], h, {
        AGLEDGER_MAX_RETRIES: '0',
      });
      expect(result.exitCode).toBe(code);
      expect(errorOf(result)).toMatchObject({ error: 'SOME_CODE', detail: `status ${status}` });
    } finally {
      server.close();
      rmSync(h, { recursive: true, force: true });
    }
  });
});
