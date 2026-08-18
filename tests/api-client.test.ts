/**
 * Query serialization for the CLI's own ApiClient.
 *
 * The client ran every query value through `String(value)`, so an object
 * arrived as the literal `[object Object]` and the engine answered 400. That
 * made `criteria[key]=value` and `metadata[key]=value` filters unreachable
 * through `agledger api`, which is the CLI's whole surface for them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiClient } from '../src/api-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOk() {
  const mockFetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

describe('ApiClient query serialization', () => {
  it('expands object params into the API bracket notation', async () => {
    const mockFetch = stubOk();
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('GET', '/v1/records/search', {
      query: { metadata: { state: 'blocked' }, criteria: { amount: '750' } },
    });

    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain('metadata[state]=blocked');
    expect(url).toContain('criteria[amount]=750');
    expect(url).not.toContain('[object Object]');
  });

  it('serializes a Date as ISO-8601 and keeps scalars untouched', async () => {
    const mockFetch = stubOk();
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('GET', '/v1/records/search', {
      query: { from: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), superseded: false, limit: 5 },
    });

    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain('from=2026-01-02T03:04:05.000Z');
    expect(url).toContain('superseded=false');
    expect(url).toContain('limit=5');
  });

  it('drops null and undefined members rather than sending them', async () => {
    const mockFetch = stubOk();
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('GET', '/v1/records/search', {
      query: { metadata: { keep: 'yes', gone: null }, skip: undefined },
    });

    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain('metadata[keep]=yes');
    expect(url).not.toContain('gone');
    expect(url).not.toContain('skip');
  });
});

/**
 * Idempotency on POST.
 *
 * The CLI could not send an `Idempotency-Key` at all, so a retry after a
 * timeout created a second record. All 18 routes the engine arms with
 * `idempotent: true` are POST, which is why the header is scoped to POST
 * rather than to every write verb.
 */
describe('ApiClient idempotency', () => {
  it('sends a generated Idempotency-Key on POST', async () => {
    const mockFetch = stubOk();
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('POST', '/v1/records', { body: { type: 'x' } });

    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('prefers an explicit key so a caller-driven retry dedups', async () => {
    const mockFetch = stubOk();
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('POST', '/v1/records', {
      body: { type: 'x' },
      idempotencyKey: 'retry-of-the-same-work',
    });

    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('retry-of-the-same-work');
  });

  it('mints a fresh key per call, so two distinct writes never collide', async () => {
    // A Response body reads once, so each call needs its own instance.
    const mockFetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('POST', '/v1/records', { body: { type: 'a' } });
    await client.request('POST', '/v1/records', { body: { type: 'b' } });

    const first = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const second = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(first['Idempotency-Key']).not.toBe(second['Idempotency-Key']);
  });

  it('omits the header on methods the engine does not arm for idempotency', async () => {
    // A Response body reads once, so each call needs its own instance.
    const mockFetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);
    const client = new ApiClient('https://api.test.com', 'key');
    await client.request('GET', '/v1/records');
    await client.request('PATCH', '/v1/records/r1', { body: { reason: 'x' } });
    await client.request('DELETE', '/v1/webhooks/w1');

    for (const call of mockFetch.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBeUndefined();
    }
  });
});
