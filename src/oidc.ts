/**
 * OIDC cert credential: exchanges a customer IdP token for a short-lived,
 * Server-signed cert (`POST /v1/auth/oidc/cert`) and signs request bodies with
 * the key bound to it.
 *
 * Nothing here touches disk except reading a token file the operator named.
 * The Ed25519 key pair lives in memory for the life of one credential (one CLI
 * invocation), and the cert is cached in memory only. The token source is
 * called for EVERY exchange: the Server refuses a token id it has already
 * exchanged (409), so a token is never reused.
 */

import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Env vars the CLI reads a token source from. The MCP server reads the same names. */
export const OIDC_ENV = {
  TOKEN_CMD: 'AGLEDGER_OIDC_TOKEN_CMD',
  TOKEN_FILE: 'AGLEDGER_OIDC_TOKEN_FILE',
  AGENT_ID: 'AGLEDGER_OIDC_AGENT_ID',
} as const;

export type OidcTokenSource =
  | { kind: 'command'; command: string; /** Where the command came from, for errors and --verbose. */ origin: string }
  | { kind: 'file'; path: string; origin: string };

/** The token source could not produce a token. `origin` names the variable or profile. */
export class OidcTokenSourceError extends Error {
  constructor(
    message: string,
    readonly origin: string,
    readonly kind: OidcTokenSource['kind'],
  ) {
    super(message);
    this.name = 'OidcTokenSourceError';
  }
}

/** The Server refused the exchange. `body` is its error response with the token scrubbed out. */
export class OidcExchangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly origin: string,
  ) {
    super(message);
    this.name = 'OidcExchangeError';
  }
}

/** The `cert` object from a 201 exchange response. Carried verbatim; the CLI reads only the times. */
export type CertInfo = Record<string, unknown> & { issuedAt?: string; expiresAt?: string };

export interface OidcCertCredentialOptions {
  source: OidcTokenSource;
  agentId?: string;
  /** Re-exchange once this fraction of the cert's lifetime has passed. Default 0.5. */
  refreshFraction?: number;
  /** Diagnostics sink for --verbose. Never receives a token, cert or key. */
  log?: (event: Record<string, unknown>) => void;
  /** Injectable for tests. */
  now?: () => number;
  fetch?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
}

const COMMAND_TIMEOUT_MS = 60_000;
const STDERR_LIMIT = 2_000;
/** A compact JWS: three base64url segments, the first a JSON header (`eyJ`). */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/** Replace anything shaped like a JWT with a placeholder. Token command stderr
 *  and Server error bodies are surfaced to the user, and either can carry one. */
export function redactTokens(text: string): string {
  return text.replace(JWT_PATTERN, '<redacted-token>');
}

/** Deep-copy a JSON value with every string passed through `redactTokens`,
 *  and any string equal to or containing `token` replaced. The Server's
 *  validation errors echo the offending input back, which for this route is
 *  the OIDC token. */
export function scrub(value: unknown, token?: string): unknown {
  if (typeof value === 'string') {
    const cut = token && token.length > 0 ? value.split(token).join('<redacted-token>') : value;
    return redactTokens(cut);
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, token));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, token)]));
  }
  return value;
}

function runTokenCommand(source: Extract<OidcTokenSource, { kind: 'command' }>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(source.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new OidcTokenSourceError(
          `${source.origin}: the token command did not finish within ${COMMAND_TIMEOUT_MS / 1000}s.`,
          source.origin,
          source.kind,
        ),
      );
    }, COMMAND_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < STDERR_LIMIT * 2) stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new OidcTokenSourceError(`${source.origin}: could not run the token command: ${err.message}`, source.origin, source.kind),
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const trimmed = redactTokens(stderr.trim()).slice(0, STDERR_LIMIT);
      const how = signal ? `was killed by ${signal}` : `exited ${code}`;
      reject(
        new OidcTokenSourceError(
          `${source.origin}: the token command ${how}${trimmed ? `. stderr: ${trimmed}` : ' with no stderr output.'}`,
          source.origin,
          source.kind,
        ),
      );
    });
  });
}

async function readTokenFile(source: Extract<OidcTokenSource, { kind: 'file' }>): Promise<string> {
  try {
    return await readFile(source.path, 'utf8');
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    throw new OidcTokenSourceError(
      `${source.origin}: cannot read the token file ${source.path}${typeof code === 'string' ? ` (${code})` : ''}.`,
      source.origin,
      source.kind,
    );
  }
}

/** Call the token source once and return a validated compact JWT plus its `sub`. */
export async function fetchOidcToken(source: OidcTokenSource): Promise<{ token: string; sub: string }> {
  const raw = source.kind === 'command' ? await runTokenCommand(source) : await readTokenFile(source);
  const token = raw.trim();
  const what = source.kind === 'command' ? 'the token command printed' : 'the token file holds';
  if (token.length === 0) {
    throw new OidcTokenSourceError(
      `${source.origin}: ${what} nothing. Expected one OIDC JWT.`,
      source.origin,
      source.kind,
    );
  }
  const parts = token.split('.');
  let sub: unknown;
  if (parts.length === 3 && parts[1]) {
    try {
      sub = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown }).sub;
    } catch {
      sub = undefined;
    }
  } else {
    // Do not echo the output: if it is a token in some other shape, it would
    // land in the error message.
    throw new OidcTokenSourceError(
      `${source.origin}: ${what} ${token.length} characters that are not a compact JWT (header.payload.signature).`,
      source.origin,
      source.kind,
    );
  }
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new OidcTokenSourceError(
      `${source.origin}: the JWT has no readable \`sub\` claim, which the proof of possession signs.`,
      source.origin,
      source.kind,
    );
  }
  return { token, sub };
}

/**
 * One cert credential. Generates its key pair on construction, exchanges on
 * first use, re-exchanges past the refresh point or when forced (a 401), and
 * shares one in-flight exchange between concurrent callers.
 */
export class OidcCertCredential {
  readonly source: OidcTokenSource;
  private readonly agentId: string | undefined;
  private readonly refreshFraction: number;
  private readonly log: (event: Record<string, unknown>) => void;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly privateKey: KeyObject;
  private readonly publicKeyX: string;

  private certJws: string | null = null;
  private certInfo: CertInfo | null = null;
  private refreshAt = 0;
  private inflight: Promise<string> | null = null;
  private exchanges = 0;

  constructor(options: OidcCertCredentialOptions) {
    this.source = options.source;
    this.agentId = options.agentId || undefined;
    this.refreshFraction = options.refreshFraction ?? 0.5;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.userAgent = options.userAgent ?? 'agledger-cli';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicKeyX = jwk.x as string;
  }

  /** The cert from the most recent exchange, as the Server returned it. */
  get cert(): CertInfo | null {
    return this.certInfo;
  }

  /** How many exchanges this credential has performed. */
  get exchangeCount(): number {
    return this.exchanges;
  }

  /**
   * A bearer for the next request: the cached cert, or a fresh one when none
   * is held or the refresh point has passed. Pass `rejected` (the bearer the
   * Server just refused with 401) to force a re-exchange; when a concurrent
   * request has already replaced that cert, the replacement is returned
   * instead of exchanging again.
   */
  async getToken(baseUrl: string, rejected?: string): Promise<string> {
    const forced = rejected !== undefined && rejected === this.certJws;
    if (!forced && this.certJws !== null && this.now() < this.refreshAt) return this.certJws;
    if (this.inflight) return this.inflight;
    const reason = forced ? 'rejected-401' : this.certJws === null ? 'initial' : 'refresh-point';
    this.inflight = this.exchange(baseUrl, reason).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** The agent signature headers for a request body, over the exact bytes sent. */
  signBody(body: string): Record<string, string> {
    const hex = createHash('sha256').update(body, 'utf8').digest('hex');
    const signature = sign(null, Buffer.from(`agledger.agent.sig.v1\n${hex}`, 'utf8'), this.privateKey);
    return {
      'X-Agent-Signature-Content-Hash': `sha256:${hex}`,
      'X-Agent-Signature': signature.toString('base64'),
    };
  }

  private async exchange(baseUrl: string, reason: string): Promise<string> {
    const { token, sub } = await fetchOidcToken(this.source);
    const proofOfPossession = sign(
      null,
      Buffer.from(`agledger.oidc.cert.v1\n${sub}`, 'utf8'),
      this.privateKey,
    ).toString('base64');
    const body = {
      oidcToken: token,
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: this.publicKeyX },
      proofOfPossession,
      ...(this.agentId ? { agentId: this.agentId } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    let parsed: unknown;
    try {
      res = await this.fetchImpl(`${baseUrl}/v1/auth/oidc/cert`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { _raw: text };
      }
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const clean = scrub(parsed, token) as Record<string, unknown>;
      const detail =
        typeof clean.detail === 'string' ? clean.detail : typeof clean.message === 'string' ? clean.message : '';
      // The Server exchanges a token id once. A token file returns the same
      // token until whatever writes it rotates it, so every CLI run after the
      // first lands here until then.
      const reuseHint =
        res.status === 409 && this.source.kind === 'file'
          ? ` The file at ${this.source.path} still holds a token this Server has already exchanged, and each token can be exchanged once. ` +
            'Run again after the file rotates, or set AGLEDGER_OIDC_TOKEN_CMD to a command that mints a new token each run (for example `kubectl create token <service-account>`).'
          : '';
      throw new OidcExchangeError(
        `OIDC cert exchange failed (token from ${this.source.origin}): POST /v1/auth/oidc/cert returned ${res.status}${detail ? `: ${detail}` : ''}${reuseHint ? `.${reuseHint}` : ''}`,
        res.status,
        clean,
        this.source.origin,
      );
    }

    const out = parsed as { certJws?: unknown; cert?: CertInfo };
    if (typeof out.certJws !== 'string' || !out.cert) {
      throw new OidcExchangeError(
        `OIDC cert exchange failed (token from ${this.source.origin}): the ${res.status} response carried no certJws.`,
        res.status,
        scrub(parsed, token),
        this.source.origin,
      );
    }
    const issued = Date.parse(String(out.cert.issuedAt));
    const expires = Date.parse(String(out.cert.expiresAt));
    const lifetime = Number.isFinite(issued) && Number.isFinite(expires) ? expires - issued : 0;
    // A cert whose times do not parse is used for this request and re-exchanged next time.
    this.refreshAt = lifetime > 0 ? issued + this.refreshFraction * lifetime : 0;
    this.certJws = out.certJws;
    this.certInfo = out.cert;
    this.exchanges += 1;
    this.log({
      event: 'oidc-exchange',
      reason,
      source: this.source.origin,
      certId: out.cert.id,
      agentId: out.cert.agentId,
      oidcSub: out.cert.oidcSub,
      issuedAt: out.cert.issuedAt,
      expiresAt: out.cert.expiresAt,
    });
    return out.certJws;
  }
}
