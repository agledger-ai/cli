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
