export interface ApiResponse {
  status: number;
  body: unknown;
  ok: boolean;
}

export class ApiClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiUrl: string, apiKey: string, timeoutMs = 30_000) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
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
    const url = new URL(path, this.apiUrl);

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
      'User-Agent': 'agledger-cli/0.4.0',
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
