import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * Offline verification of an AGLedger audit export.
 *
 * Re-implements the vault's per-entry integrity check (RFC 8785 JCS → SHA-256
 * → Ed25519 over `{position}:{payloadHash}:{previousHash}`) and walks the hash
 * chain. Makes no network calls.
 *
 * Duplicated in each shipping surface (TS SDK, CLI, MCP server) on purpose —
 * see feedback_mcp_no_sdk.md. The CLI/MCP are not allowed to depend on
 * @agledger/sdk even for offline crypto. Three independent copies in this
 * repo, plus an independent Python port, also serves as a cross-implementation
 * correctness check via the shared test vectors at testdata/verifier/.
 */

export interface AuditExportEntry {
  position: number;
  timestamp: string;
  entryType: string;
  description: string;
  payload: Record<string, unknown>;
  integrity: {
    payloadHash: string;
    hashAlg?: string;
    previousHash: string | null;
    signature: string | null;
    signatureAlg?: string;
    signingKeyId: string | null;
    valid: boolean;
  };
}

export interface RecordAuditExport {
  exportMetadata: {
    recordId: string;
    enterpriseId: string | null;
    type: string;
    exportDate: string;
    totalEntries: number;
    chainIntegrity: boolean;
    exportFormatVersion: string;
    canonicalization: string;
    signingPublicKey: string | null;
    signingPublicKeys?: Record<string, string>;
  };
  entries: AuditExportEntry[];
}

export interface EntryVerificationResult {
  position: number;
  valid: boolean;
  reason?: EntryFailureReason;
  detail?: string;
}

export type EntryFailureReason =
  | 'payload_hash_mismatch'
  | 'chain_break'
  | 'position_gap'
  | 'signature_invalid'
  | 'unknown_key'
  | 'malformed_entry'
  | 'unsupported_algorithm';

export interface VerifyExportResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  brokenAt?: {
    position: number;
    reason: EntryFailureReason;
    detail?: string;
  };
  entries: EntryVerificationResult[];
  recordId: string;
}

export interface VerifyExportOptions {
  publicKeys?: Record<string, string>;
  requireKeyId?: string;
}

const RFC8785 = 'RFC8785';
const SUPPORTED_HASH = new Set(['SHA-256', 'sha-256', 'sha256']);
const SUPPORTED_SIG = new Set(['Ed25519', 'ed25519']);

export function verifyExport(
  exportData: RecordAuditExport,
  options: VerifyExportOptions = {},
): VerifyExportResult {
  const meta = exportData.exportMetadata;
  const entries = exportData.entries ?? [];
  const keys = new KeyCache(resolveKeys(exportData, options));
  const entryResults: EntryVerificationResult[] = [];
  let verifiedEntries = 0;
  let brokenAt: VerifyExportResult['brokenAt'];

  if (meta.canonicalization && meta.canonicalization !== RFC8785) {
    const detail = `Unsupported canonicalization: ${meta.canonicalization} (only RFC8785 supported)`;
    const result: EntryVerificationResult = {
      position: 0,
      valid: false,
      reason: 'unsupported_algorithm',
      detail,
    };
    return {
      valid: false,
      totalEntries: entries.length,
      verifiedEntries: 0,
      brokenAt: { position: 0, reason: 'unsupported_algorithm', detail },
      entries: [result],
      recordId: meta.recordId,
    };
  }

  let prevPayloadHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const result = verifyEntry(entry, i + 1, prevPayloadHash, keys, options.requireKeyId);
    entryResults.push(result);
    if (result.valid) {
      verifiedEntries++;
    } else if (!brokenAt && result.reason) {
      brokenAt = { position: result.position, reason: result.reason, detail: result.detail };
    }
    prevPayloadHash = entry.integrity.payloadHash;
  }

  return {
    valid: verifiedEntries === entries.length && entries.length > 0,
    totalEntries: entries.length,
    verifiedEntries,
    brokenAt,
    entries: entryResults,
    recordId: meta.recordId,
  };
}

function resolveKeys(
  exportData: RecordAuditExport,
  options: VerifyExportOptions,
): Record<string, string> {
  const meta = exportData.exportMetadata;
  const merged: Record<string, string> = {};
  if (meta.signingPublicKeys) {
    for (const [k, v] of Object.entries(meta.signingPublicKeys)) merged[k] = v;
  }
  if (options.publicKeys) {
    for (const [k, v] of Object.entries(options.publicKeys)) merged[k] = v;
  }
  return merged;
}

class KeyCache {
  private readonly cache = new Map<string, KeyObject>();
  constructor(private readonly spki: Record<string, string>) {}

  get(keyId: string): KeyObject | undefined {
    const existing = this.cache.get(keyId);
    if (existing) return existing;
    const raw = this.spki[keyId];
    if (!raw) return undefined;
    const key = createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
    this.cache.set(keyId, key);
    return key;
  }
}

function verifyEntry(
  entry: AuditExportEntry,
  expectedPosition: number,
  expectedPrevHash: string | null,
  keys: KeyCache,
  requireKeyId: string | undefined,
): EntryVerificationResult {
  const position = entry.position;

  if (entry.position !== expectedPosition) {
    return {
      position,
      valid: false,
      reason: 'position_gap',
      detail: `Expected position ${expectedPosition}, got ${entry.position}`,
    };
  }

  const { payloadHash, previousHash, signature, signingKeyId, hashAlg, signatureAlg } =
    entry.integrity;

  if (hashAlg && !SUPPORTED_HASH.has(hashAlg)) {
    return { position, valid: false, reason: 'unsupported_algorithm', detail: `hashAlg=${hashAlg}` };
  }
  if (signatureAlg && !SUPPORTED_SIG.has(signatureAlg)) {
    return {
      position,
      valid: false,
      reason: 'unsupported_algorithm',
      detail: `signatureAlg=${signatureAlg}`,
    };
  }

  if (previousHash !== expectedPrevHash) {
    return {
      position,
      valid: false,
      reason: 'chain_break',
      detail: `Expected previousHash=${expectedPrevHash ?? 'null'}, got ${previousHash ?? 'null'}`,
    };
  }

  const recomputed = sha256Hex(canonicalize(entry.payload));
  if (recomputed !== payloadHash) {
    return {
      position,
      valid: false,
      reason: 'payload_hash_mismatch',
      detail: `Recomputed ${recomputed.slice(0, 16)}…, stored ${payloadHash.slice(0, 16)}…`,
    };
  }

  if (!signature || !signingKeyId) {
    return {
      position,
      valid: false,
      reason: 'malformed_entry',
      detail: 'Missing signature or signingKeyId',
    };
  }

  if (requireKeyId && signingKeyId !== requireKeyId) {
    return {
      position,
      valid: false,
      reason: 'unknown_key',
      detail: `Entry keyId=${signingKeyId} does not match requireKeyId=${requireKeyId}`,
    };
  }

  const publicKey = keys.get(signingKeyId);
  if (!publicKey) {
    return {
      position,
      valid: false,
      reason: 'unknown_key',
      detail: `No public key for keyId=${signingKeyId}`,
    };
  }

  const signInput = `${position}:${payloadHash}:${previousHash ?? 'null'}`;
  let sigValid = false;
  try {
    sigValid = verifyEd25519(publicKey, signInput, signature);
  } catch (err) {
    return {
      position,
      valid: false,
      reason: 'signature_invalid',
      detail: `Signature verification threw: ${(err as Error).message}`,
    };
  }

  if (!sigValid) {
    return { position, valid: false, reason: 'signature_invalid' };
  }

  return { position, valid: true };
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') +
      '}'
    );
  }
  return 'null';
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function verifyEd25519(publicKey: KeyObject, message: string, signatureHex: string): boolean {
  return cryptoVerify(null, Buffer.from(message), publicKey, Buffer.from(signatureHex, 'hex'));
}
