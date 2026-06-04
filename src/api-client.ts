export interface ApiResponse {
  status: number;
  body: unknown;
  ok: boolean;
}

export class ApiClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(apiUrl: string, apiKey: string, version = '0.0.0', timeoutMs = 30_000) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.userAgent = `agledger-cli/${version}`;
    this.timeoutMs = timeoutMs;
  }

  async request(
    method: string,
    path: string,
    options?: {
      query?: Record<string, unknown>;
      body?: unknown;
    },
  ): Promise<ApiResponse> {
    // Reject protocol-relative paths ("//host/...") — with `new URL` they would
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
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };

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
