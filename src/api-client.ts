export interface ApiResponse {
  status: number;
  body: unknown;
  ok: boolean;
}

/**
 * Serialize one query parameter.
 *
 * A plain object becomes the API's bracket notation (`metadata[key]=value`),
 * which is what the `criteria` and `metadata` filters on
 * GET /v1/records/search expect. Running it through `String(value)` instead
 * sent the literal `[object Object]`, so every such filter returned 400.
 *
 * A Date becomes ISO-8601 rather than the JS locale form, which the date-time
 * query params reject.
 */
function appendQueryParam(search: URLSearchParams, key: string, value: unknown): void {
  if (value instanceof Date) {
    search.set(key, value.toISOString());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined || item === null) continue;
      search.append(key, item instanceof Date ? item.toISOString() : String(item));
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
      if (subValue === undefined || subValue === null) continue;
      search.set(
        `${key}[${sub}]`,
        subValue instanceof Date ? subValue.toISOString() : String(subValue),
      );
    }
    return;
  }
  search.set(key, String(value));
}

export class ApiClient {
  private readonly apiUrl: string;
  /** Null sends no Authorization header: the Server's discovery surfaces
   *  (/health, /llms.txt, /openapi.json, /v1/conformance) answer unauthenticated,
   *  and an agent holding only a URL must be able to reach them. */
  private readonly apiKey: string | null;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(apiUrl: string, apiKey: string | null, version = '0.0.0', timeoutMs = 30_000) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.userAgent = `agledger-cli/${version}`;
    this.timeoutMs = timeoutMs;
  }

  /** The base URL requests go to. Surfaced so a network failure can name the
   *  host it actually tried instead of a bare "fetch failed". */
  get baseUrl(): string {
    return this.apiUrl;
  }

  async request(
    method: string,
    path: string,
    options?: {
      query?: Record<string, unknown>;
      body?: unknown;
    },
  ): Promise<ApiResponse> {
    // Reject protocol-relative paths ("//host/...") because with `new URL` they would
    // be resolved against the base's protocol and silently retarget the request
    // to an attacker-controlled host. A legitimate API path starts with a single
    // "/". Callers (api.ts) guarantee a leading slash.
    if (path.startsWith('//')) {
      throw new Error(`Invalid path '${path}': protocol-relative paths are not allowed`);
    }

    // Concatenate rather than `new URL(path, base)` so any base-URL path prefix
    // (e.g. an API gateway mount point) is preserved instead of being dropped.
    // `apiUrl` has trailing slashes stripped; `path` is guaranteed leading-slash.
    const url = new URL(this.apiUrl + path);

    if (options?.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null) {
          appendQueryParam(url.searchParams, k, v);
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };

    if (this.apiKey !== null) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      let body: unknown;

      if (contentType.includes('json')) {
        body = await res.json();
      } else {
        const text = await res.text();
        body = { _raw: text, _contentType: contentType };
      }

      return { status: res.status, body, ok: res.ok };
    } finally {
      clearTimeout(timeout);
    }
  }
}
