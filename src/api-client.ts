import type { DelegationToken, OidcCertCredential } from './oidc.js';

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
  /** An API key, an OIDC cert credential, or null. Null sends no
   *  Authorization header: the Server's discovery surfaces (/health, /llms.txt,
   *  /openapi.json, /v1/conformance) answer unauthenticated, and an agent
   *  holding only a URL must be able to reach them. */
  private readonly auth: string | OidcCertCredential | null;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  /** Sent as `AGLedger-On-Behalf-Of` on POST. Every route that declares the
   *  header is a POST, and the Server ignores it on routes that do not. */
  private readonly onBehalfOf: DelegationToken | null;

  constructor(
    apiUrl: string,
    auth: string | OidcCertCredential | null,
    version = '0.0.0',
    timeoutMs = 30_000,
    onBehalfOf: DelegationToken | null = null,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.auth = auth;
    this.userAgent = `agledger-cli/${version}`;
    this.timeoutMs = timeoutMs;
    this.onBehalfOf = onBehalfOf;
  }

  /** The OIDC credential in use, if any, so `auth` can show the cert identity. */
  get credential(): OidcCertCredential | null {
    return this.auth !== null && typeof this.auth === 'object' ? this.auth : null;
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
      idempotencyKey?: string;
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

    // Serialized once: with a cert credential the agent signature covers these
    // exact bytes, so the body that is hashed must be the body that is sent.
    const body = options?.body !== undefined ? JSON.stringify(options.body) : undefined;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // POST is the only method the API arms for idempotency: all 18 routes that
    // declare `idempotent: true` are POST, and on any other method the header is
    // ignored. A generated key makes the CLI's own writes replay-safe by default;
    // a caller retrying the same logical operation across processes passes its
    // own key so the second attempt dedups instead of creating a second record.
    if (method.toUpperCase() === 'POST') {
      headers['Idempotency-Key'] = options?.idempotencyKey ?? crypto.randomUUID();
      if (this.onBehalfOf) headers['AGLedger-On-Behalf-Of'] = await this.onBehalfOf.get();
    }

    const credential = this.credential;
    if (typeof this.auth === 'string') {
      headers.Authorization = `Bearer ${this.auth}`;
    }
    if (credential && body !== undefined) {
      Object.assign(headers, credential.signBody(body));
    }

    if (!credential) return this.send(url, method, headers, body);

    const bearer = await credential.getToken(this.apiUrl);
    const first = await this.send(url, method, { ...headers, Authorization: `Bearer ${bearer}` }, body);
    // A cert the Server stops accepting (expired, revoked, clock skew) gets one
    // re-exchange and one retry. A second 401 is reported as it came. The
    // retry reuses the Idempotency-Key: a 401 means nothing was processed.
    if (first.status !== 401) return first;
    const renewed = await credential.getToken(this.apiUrl, bearer);
    return this.send(url, method, { ...headers, Authorization: `Bearer ${renewed}` }, body);
  }

  private async send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<ApiResponse> {

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      let resBody: unknown;

      if (contentType.includes('json')) {
        resBody = await res.json();
      } else {
        const text = await res.text();
        resBody = { _raw: text, _contentType: contentType };
      }

      return { status: res.status, body: resBody, ok: res.ok };
    } finally {
      clearTimeout(timeout);
    }
  }
}
