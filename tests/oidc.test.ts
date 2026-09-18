/**
 * OIDC cert credential: the token source, the exchange, refresh, the single
 * 401 retry, and agent body signing. Every network call is a stubbed fetch.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api-client.js';
import {
  OidcCertCredential,
  OidcExchangeError,
  OidcTokenSourceError,
  fetchOidcToken,
  scrub,
  type OidcTokenSource,
} from '../src/oidc.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwtFor = (sub: string, n = 0) =>
  `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub, n }))}.c2lnbmF0dXJl`;

const FIXED_JWT = jwtFor('agent-1');
const commandSource = (jwt = FIXED_JWT): OidcTokenSource => ({
  kind: 'command',
  command: `printf '%s' '${jwt}'`,
  origin: 'AGLEDGER_OIDC_TOKEN_CMD',
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Harness {
  fetch: ReturnType<typeof vi.fn>;
  exchanges: Array<Record<string, unknown>>;
  apiCalls: Array<{ url: string; init: RequestInit }>;
}

/**
 * Stub fetch: POST /v1/auth/oidc/cert issues `cert-<n>` with a 120s lifetime
 * starting at `issuedAt()`; every other call goes to `api`.
 */
function harness(
  api: (url: string, init: RequestInit, h: Harness) => Response | Promise<Response> = () => json(200, {}),
  issuedAt: () => number = () => Date.now(),
): Harness {
  const h: Harness = { fetch: vi.fn(), exchanges: [], apiCalls: [] };
  h.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/v1/auth/oidc/cert')) {
      h.exchanges.push(JSON.parse(String(init.body)));
      const n = h.exchanges.length;
      const t = issuedAt();
      return json(201, {
        certJws: `cert-${n}`,
        cert: {
          id: `cert-id-${n}`,
          agentId: 'agent-uuid',
          oidcSub: 'agent-1',
          issuedAt: new Date(t).toISOString(),
          expiresAt: new Date(t + 120_000).toISOString(),
        },
      });
    }
    h.apiCalls.push({ url, init });
    return api(url, init, h);
  });
  vi.stubGlobal('fetch', h.fetch);
  return h;
}

const authOf = (call: { init: RequestInit }) => (call.init.headers as Record<string, string>).Authorization;

describe('token source', () => {
  it('a command printing a fixed JWT drives one exchange with the exact body shape', async () => {
    const h = harness();
    const credential = new OidcCertCredential({ source: commandSource(), agentId: 'agent-uuid' });
    const client = new ApiClient('https://api.test', credential);
    await client.request('GET', '/v1/auth/me');

    expect(h.exchanges).toHaveLength(1);
    const body = h.exchanges[0]!;
    expect(Object.keys(body).sort()).toEqual(['agentId', 'oidcToken', 'proofOfPossession', 'publicKeyJwk']);
    expect(body.oidcToken).toBe(FIXED_JWT);
    expect(body.agentId).toBe('agent-uuid');

    const jwk = body.publicKeyJwk as { kty: string; crv: string; x: string };
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x']);
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');

    // STANDARD base64 with mandatory padding: 64 bytes is 88 characters.
    const pop = body.proofOfPossession as string;
    expect(pop).toHaveLength(88);
    expect(pop).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    expect(
      verify(null, Buffer.from('agledger.oidc.cert.v1\nagent-1', 'utf8'), publicKey, Buffer.from(pop, 'base64')),
    ).toBe(true);

    // The cert, not the OIDC token, is the bearer.
    expect(authOf(h.apiCalls[0]!)).toBe('Bearer cert-1');
  });

  it('omits agentId when none is configured', async () => {
    const h = harness();
    await new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() })).request(
      'GET',
      '/v1/auth/me',
    );
    expect(h.exchanges[0]).not.toHaveProperty('agentId');
  });

  it('a failing command names the variable and surfaces its stderr, with any token redacted', async () => {
    const source: OidcTokenSource = {
      kind: 'command',
      command: `echo "idp said no; last token ${FIXED_JWT}" >&2; exit 7`,
      origin: 'AGLEDGER_OIDC_TOKEN_CMD',
    };
    const err = await fetchOidcToken(source).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcTokenSourceError);
    const message = (err as Error).message;
    expect(message).toContain('AGLEDGER_OIDC_TOKEN_CMD');
    expect(message).toContain('exited 7');
    expect(message).toContain('idp said no');
    expect(message).not.toContain(FIXED_JWT);
    expect(message).toContain('<redacted-token>');
  });

  it('refuses output that is not a JWT without echoing it', async () => {
    const source: OidcTokenSource = { kind: 'command', command: 'echo s3cr3t-opaque-value', origin: 'AGLEDGER_OIDC_TOKEN_CMD' };
    const err = (await fetchOidcToken(source).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(OidcTokenSourceError);
    expect(err.message).toContain('not a compact JWT');
    expect(err.message).not.toContain('s3cr3t');
  });

  it('refuses empty output', async () => {
    const source: OidcTokenSource = { kind: 'command', command: 'true', origin: 'AGLEDGER_OIDC_TOKEN_CMD' };
    await expect(fetchOidcToken(source)).rejects.toThrow(/AGLEDGER_OIDC_TOKEN_CMD: the token command printed nothing/);
  });

  it('a missing token file names the variable and the path', async () => {
    const source: OidcTokenSource = { kind: 'file', path: '/nonexistent/token', origin: 'AGLEDGER_OIDC_TOKEN_FILE' };
    await expect(fetchOidcToken(source)).rejects.toThrow(/AGLEDGER_OIDC_TOKEN_FILE: cannot read the token file \/nonexistent\/token \(ENOENT\)/);
  });

  it('reads the token file again on every exchange, so a rotated token is picked up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oidc-file-'));
    const path = join(dir, 'token');
    writeFileSync(path, `${jwtFor('agent-1', 1)}\n`);
    let now = Date.now();
    const h = harness(undefined, () => now);
    const credential = new OidcCertCredential({
      source: { kind: 'file', path, origin: 'AGLEDGER_OIDC_TOKEN_FILE' },
      now: () => now,
    });
    const client = new ApiClient('https://api.test', credential);
    await client.request('GET', '/v1/auth/me');
    writeFileSync(path, jwtFor('agent-1', 2));
    now += 61_000;
    await client.request('GET', '/v1/auth/me');
    expect(h.exchanges.map((b) => b.oidcToken)).toEqual([jwtFor('agent-1', 1), jwtFor('agent-1', 2)]);
  });
});

describe('cert lifetime', () => {
  it('reuses the cert before the refresh point and re-exchanges after it', async () => {
    let now = Date.parse('2026-09-18T00:00:00Z');
    const h = harness(undefined, () => now);
    const client = new ApiClient(
      'https://api.test',
      new OidcCertCredential({ source: commandSource(), now: () => now }),
    );
    await client.request('GET', '/v1/records');
    now += 59_000; // under half of 120s
    await client.request('GET', '/v1/records');
    expect(h.exchanges).toHaveLength(1);
    now += 2_000; // past half
    await client.request('GET', '/v1/records');
    expect(h.exchanges).toHaveLength(2);
    expect(h.apiCalls.map(authOf)).toEqual(['Bearer cert-1', 'Bearer cert-1', 'Bearer cert-2']);
  });

  it('honours a custom refreshFraction', async () => {
    let now = Date.parse('2026-09-18T00:00:00Z');
    const h = harness(undefined, () => now);
    const client = new ApiClient(
      'https://api.test',
      new OidcCertCredential({ source: commandSource(), now: () => now, refreshFraction: 0.9 }),
    );
    await client.request('GET', '/v1/records');
    now += 100_000;
    await client.request('GET', '/v1/records');
    expect(h.exchanges).toHaveLength(1);
    now += 9_000;
    await client.request('GET', '/v1/records');
    expect(h.exchanges).toHaveLength(2);
  });

  it('a 401 on a cert bearer forces exactly one re-exchange and one retry', async () => {
    const h = harness((_url, init) =>
      authOf({ init }) === 'Bearer cert-1' ? json(401, { error: 'UNAUTHORIZED' }) : json(200, { ok: true }),
    );
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    const res = await client.request('POST', '/v1/records', { body: { type: 'x' } });
    expect(res.status).toBe(200);
    expect(h.exchanges).toHaveLength(2);
    expect(h.apiCalls.map(authOf)).toEqual(['Bearer cert-1', 'Bearer cert-2']);
    // The retry is the same request: same Idempotency-Key and signed body.
    const [first, second] = h.apiCalls.map((c) => c.init.headers as Record<string, string>);
    expect(second!['Idempotency-Key']).toBe(first!['Idempotency-Key']);
    expect(second!['X-Agent-Signature']).toBe(first!['X-Agent-Signature']);
    expect(h.apiCalls[1]!.init.body).toBe(h.apiCalls[0]!.init.body);
  });

  it('a second 401 surfaces as the response, with no further exchange', async () => {
    const h = harness(() => json(401, { error: 'UNAUTHORIZED', message: 'cert revoked' }));
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    const res = await client.request('GET', '/v1/records');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED', message: 'cert revoked' });
    expect(h.exchanges).toHaveLength(2);
    expect(h.apiCalls).toHaveLength(2);
  });

  it('an API key 401 is not retried', async () => {
    const h = harness(() => json(401, { error: 'UNAUTHORIZED' }));
    const res = await new ApiClient('https://api.test', 'agl_agt_x').request('GET', '/v1/records');
    expect(res.status).toBe(401);
    expect(h.exchanges).toHaveLength(0);
    expect(h.apiCalls).toHaveLength(1);
  });

  it('concurrent requests share one in-flight exchange', async () => {
    const h = harness();
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    await Promise.all(Array.from({ length: 8 }, () => client.request('GET', '/v1/records')));
    expect(h.exchanges).toHaveLength(1);
    expect(new Set(h.apiCalls.map(authOf))).toEqual(new Set(['Bearer cert-1']));
  });

  it('concurrent 401s on the same cert re-exchange once', async () => {
    const h = harness((_url, init) =>
      authOf({ init }) === 'Bearer cert-1' ? json(401, {}) : json(200, {}),
    );
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    const results = await Promise.all(Array.from({ length: 4 }, () => client.request('GET', '/v1/records')));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(h.exchanges).toHaveLength(2);
  });
});

describe('agent body signature', () => {
  it('signs the sha256 of the exact bytes sent, under the agent signature context', async () => {
    const h = harness();
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    await client.request('POST', '/v1/records', { body: { type: 'notarize-generic-v1', criteria: { summary: 'é ✓' } } });

    const sent = h.apiCalls[0]!;
    const headers = sent.init.headers as Record<string, string>;
    const hex = createHash('sha256').update(Buffer.from(String(sent.init.body), 'utf8')).digest('hex');
    expect(headers['X-Agent-Signature-Content-Hash']).toBe(`sha256:${hex}`);
    expect(headers['X-Agent-Signature']).toMatch(/^[A-Za-z0-9+/]{86}==$/);

    const publicKey = createPublicKey({ key: h.exchanges[0]!.publicKeyJwk as never, format: 'jwk' });
    expect(
      verify(
        null,
        Buffer.from(`agledger.agent.sig.v1\n${hex}`, 'utf8'),
        publicKey,
        Buffer.from(headers['X-Agent-Signature']!, 'base64'),
      ),
    ).toBe(true);
  });

  it('sends no signature headers on a request without a body, or with an API key', async () => {
    const h = harness();
    await new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() })).request(
      'GET',
      '/v1/records',
    );
    await new ApiClient('https://api.test', 'agl_agt_x').request('POST', '/v1/records', { body: { a: 1 } });
    for (const call of h.apiCalls) {
      expect(call.init.headers).not.toHaveProperty('X-Agent-Signature');
      expect(call.init.headers).not.toHaveProperty('X-Agent-Signature-Content-Hash');
    }
  });
});

describe('exchange failures and secrecy', () => {
  it('a refused exchange names the OIDC exchange and the source, with the token scrubbed from the Server body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(400, {
          error: 'VALIDATION_ERROR',
          detail: 'body/oidcToken is invalid',
          recoveryHint: 'Acquire a fresh OIDC token.',
          details: [{ instancePath: '/oidcToken', received: FIXED_JWT }],
        }),
      ),
    );
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    const err = (await client.request('GET', '/v1/auth/me').catch((e: unknown) => e)) as OidcExchangeError;
    expect(err).toBeInstanceOf(OidcExchangeError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('OIDC cert exchange failed');
    expect(err.message).toContain('AGLEDGER_OIDC_TOKEN_CMD');
    expect(JSON.stringify(err.body)).not.toContain(FIXED_JWT);
    expect((err.body as { recoveryHint: string }).recoveryHint).toBe('Acquire a fresh OIDC token.');
  });

  it('a 409 on a token file explains that the file has not rotated and names the command source', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'agl-oidc-')), 'token');
    writeFileSync(path, FIXED_JWT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, { error: 'CONFLICT', detail: 'This OIDC token id has already been exchanged for a cert from this issuer' }),
      ),
    );
    const source: OidcTokenSource = { kind: 'file', path, origin: 'AGLEDGER_OIDC_TOKEN_FILE' };
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source }));
    const err = (await client.request('GET', '/v1/auth/me').catch((e: unknown) => e)) as OidcExchangeError;
    expect(err).toBeInstanceOf(OidcExchangeError);
    expect(err.status).toBe(409);
    expect(err.message).toContain(`The file at ${path} still holds a token this Server has already exchanged`);
    expect(err.message).toContain('AGLEDGER_OIDC_TOKEN_CMD');
    expect(err.message).not.toContain(FIXED_JWT);
  });

  it('a 409 on a token command carries no file hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { error: 'CONFLICT', detail: 'already exchanged' })),
    );
    const client = new ApiClient('https://api.test', new OidcCertCredential({ source: commandSource() }));
    const err = (await client.request('GET', '/v1/auth/me').catch((e: unknown) => e)) as OidcExchangeError;
    expect(err.message).toBe(
      'OIDC cert exchange failed (token from AGLEDGER_OIDC_TOKEN_CMD): POST /v1/auth/oidc/cert returned 409: already exchanged',
    );
  });

  it('diagnostics never carry the OIDC token or the cert', async () => {
    harness();
    const events: string[] = [];
    const client = new ApiClient(
      'https://api.test',
      new OidcCertCredential({ source: commandSource(), log: (e) => events.push(JSON.stringify(e)) }),
    );
    await client.request('GET', '/v1/auth/me');
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"event":"oidc-exchange"');
    expect(events[0]).toContain('cert-id-1');
    expect(events.join('')).not.toContain(FIXED_JWT);
    expect(events.join('')).not.toContain('cert-1"');
  });

  it('scrub redacts the token and JWT-shaped strings at any depth', () => {
    expect(scrub({ a: [`x ${FIXED_JWT} y`], b: { c: 'opaque-tok' }, n: 1 }, 'opaque-tok')).toEqual({
      a: ['x <redacted-token> y'],
      b: { c: '<redacted-token>' },
      n: 1,
    });
  });
});
