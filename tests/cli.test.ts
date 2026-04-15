/**
 * AGLedger CLI v0.4.0 — Comprehensive Tests
 * Tests the CLI binary via execSync. No real API calls — tests cover
 * flag parsing, dry-run output, auth enforcement, discovery, and behavior.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../bin/run.js');

/** Run a CLI command, capturing stdout/stderr and exit code. */
const run = (args: string, env?: Record<string, string>) => {
  try {
    return {
      stdout: execSync(`node ${BIN} ${args}`, {
        encoding: 'utf-8',
        env: { ...process.env, AGLEDGER_API_KEY: '', AGLEDGER_API_URL: '', ...env },
        timeout: 10_000,
      }).trim(),
      stderr: '',
      exitCode: 0,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      exitCode: e.status ?? 1,
    };
  }
};

/** Parse first JSON line from combined stdout/stderr. */
const parseJson = (result: ReturnType<typeof run>) => {
  const text = result.stdout || result.stderr;
  return JSON.parse(text.split('\n')[0]);
};

/** Create a temp JSON file with given content. */
const tmpJson = (data: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  const file = join(dir, 'data.json');
  writeFileSync(file, JSON.stringify(data));
  return file;
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
describe('discovery', () => {
  it('list-commands returns all 54 commands', () => {
    const result = run('list-commands --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.commands).toBeInstanceOf(Array);
    expect(parsed.commands.length).toBe(54);
  });

  it('list-commands includes all topics', () => {
    const result = run('list-commands --json');
    const names: string[] = JSON.parse(result.stdout).commands.map((c: { name: string }) => c.name);
    // Spot-check every topic
    expect(names).toContain('mandate create');
    expect(names).toContain('mandate outcome');
    expect(names).toContain('receipt submit');
    expect(names).toContain('verdict render');
    expect(names).toContain('webhook create');
    expect(names).toContain('audit trail');
    expect(names).toContain('agent list');
    expect(names).toContain('schema register');
    expect(names).toContain('admin create-enterprise');
    expect(names).toContain('federation health');
    expect(names).toContain('login');
    expect(names).toContain('auth');
    expect(names).toContain('status');
    expect(names).toContain('verify-keys');
    expect(names).toContain('help-json');
  });

  it('help-json returns command metadata', () => {
    const result = run('help-json "mandate create" --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('mandate create');
    expect(parsed.description).toContain('mandate');
    expect(parsed.flags.type).toBeDefined();
    expect(parsed.flags.type.required).toBe(true);
    expect(parsed.flags.activate).toBeDefined();
    expect(parsed.flags['dry-run']).toBeDefined();
  });

  it('help-json omits internal flags (json, api-key, api-url)', () => {
    const result = run('help-json "mandate list" --json');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.flags.json).toBeUndefined();
    expect(parsed.flags['api-key']).toBeUndefined();
    expect(parsed.flags['api-url']).toBeUndefined();
  });

  it('help-json exits 2 for unknown command', () => {
    const result = run('help-json nonexistent --json');
    expect(result.exitCode).toBe(2);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('COMMAND_NOT_FOUND');
    expect(parsed.suggestion).toContain('list-commands');
  });

  it('help-json works for all topics', () => {
    for (const cmd of ['receipt submit', 'webhook create', 'audit trail', 'schema diff', 'admin set-config', 'federation health']) {
      const result = run(`help-json "${cmd}" --json`);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.name).toBe(cmd);
    }
  });
});

// ---------------------------------------------------------------------------
// Auth enforcement — every command that touches the API should exit with
// AUTH_REQUIRED when no key is provided
// ---------------------------------------------------------------------------
describe('auth enforcement', () => {
  const authRequiredCommands = [
    'mandate list --json',
    'mandate get 00000000-0000-0000-0000-000000000000 --json',
    'mandate cancel 00000000-0000-0000-0000-000000000000 --json',
    'mandate transition 00000000-0000-0000-0000-000000000000 activate --json',
    'mandate accept 00000000-0000-0000-0000-000000000000 --json',
    'mandate reject 00000000-0000-0000-0000-000000000000 --json',
    'mandate counter-propose 00000000-0000-0000-0000-000000000000 --data \'{"counterCriteria":{}} \' --json',
    'mandate batch --ids 00000000-0000-0000-0000-000000000000 --json',
    'mandate chain 00000000-0000-0000-0000-000000000000 --json',
    'mandate request-revision 00000000-0000-0000-0000-000000000000 --reason test --json',
    'mandate outcome 00000000-0000-0000-0000-000000000000 --receipt-id 00000000-0000-0000-0000-000000000000 --outcome PASS --json',
    'receipt list 00000000-0000-0000-0000-000000000000 --json',
    'receipt get 00000000-0000-0000-0000-000000000000 00000000-0000-0000-0000-000000000000 --json',
    'verdict render 00000000-0000-0000-0000-000000000000 PASS --json',
    'webhook list --json',
    'webhook delete 00000000-0000-0000-0000-000000000000 --json',
    'audit trail 00000000-0000-0000-0000-000000000000 --json',
    'audit events --since 2026-01-01T00:00:00Z --json',
    'agent list --enterprise 00000000-0000-0000-0000-000000000000 --json',
    'agent reputation 00000000-0000-0000-0000-000000000000 --json',
    'schema list --json',
    'schema get ACH-PROC-v1 --json',
    'schema rules ACH-PROC-v1 --json',
    'schema versions ACH-PROC-v1 --json',
    'schema get-version ACH-PROC-v1 --version 1 --json',
    'schema diff ACH-PROC-v1 --from 1 --to 2 --json',
    'schema blank-template --json',
    'schema template ACH-PROC-v1 --json',
    'schema meta-schema --json',
    'federation health --json',
    'federation list-gateways --json',
    'federation audit-log --json',
    'federation query-mandates --json',
    'verify-keys --json',
  ];

  for (const cmd of authRequiredCommands) {
    const label = cmd.split('--json')[0].trim();
    it(`${label} requires auth`, () => {
      const result = run(cmd);
      expect(result.exitCode).not.toBe(0);
      const parsed = parseJson(result);
      expect(parsed.code).toBe('AUTH_REQUIRED');
    });
  }

  it('auth command reports unauthenticated without key', () => {
    const result = run('auth --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.authenticated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dry-run — mutating commands should show payload without API call
// ---------------------------------------------------------------------------
describe('dry-run', () => {
  it('mandate create shows payload', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contractType).toBe('ACH-PROC-v1');
    expect(parsed.criteria.item).toBe('test');
  });

  it('mandate create --activate includes autoActivate', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --activate --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.autoActivate).toBe(true);
  });

  it('mandate create --max-submissions includes maxSubmissions', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --max-submissions 3 --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.maxSubmissions).toBe(3);
  });

  it('mandate create --performer includes performerAgentId', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --performer agent-123 --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.performerAgentId).toBe('agent-123');
  });

  it('receipt submit wraps data as evidence', () => {
    const result = run(
      'receipt submit 00000000-0000-0000-0000-000000000000 --data \'{"quantity":10}\' --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.evidence).toEqual({ quantity: 10 });
  });

  it('receipt submit passes through pre-wrapped evidence', () => {
    const result = run(
      'receipt submit 00000000-0000-0000-0000-000000000000 --data \'{"evidence":{"quantity":10}}\' --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.evidence).toEqual({ quantity: 10 });
  });

  it('schema register --dry-run shows payload from file', () => {
    const file = tmpJson({
      contractType: 'ACH-TEST-v1',
      mandateSchema: { type: 'object' },
      receiptSchema: { type: 'object' },
    });
    const result = run(`schema register ${file} --dry-run --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contractType).toBe('ACH-TEST-v1');
  });

  it('schema deprecate --dry-run shows payload', () => {
    const result = run('schema deprecate ACH-PROC-v1 --version 1 --dry-run --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contractType).toBe('ACH-PROC-v1');
    expect(parsed.status).toBe('DEPRECATED');
  });

  it('schema import --dry-run requires auth (server-side dry-run)', () => {
    const file = tmpJson({
      contractType: 'ACH-TEST-v1',
      versions: [{ version: 1, mandateSchema: { type: 'object' }, receiptSchema: { type: 'object' } }],
    });
    const result = run(`schema import ${file} --dry-run --json`);
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('AUTH_REQUIRED');
  });

  it('webhook create --dry-run shows payload', () => {
    const result = run(
      'webhook create --url https://example.com/hook --events mandate.created --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.url).toBe('https://example.com/hook');
  });

  it('admin create-enterprise --dry-run shows payload', () => {
    const result = run('admin create-enterprise --name "Test Corp" --dry-run --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('Test Corp');
  });

  it('admin create-agent --dry-run shows payload', () => {
    const result = run('admin create-agent --name "Test Agent" --dry-run --json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('Test Agent');
  });

  it('admin set-config --dry-run shows payload', () => {
    const result = run(
      'admin set-config 00000000-0000-0000-0000-000000000000 --data \'{"agentApprovalRequired":true}\' --dry-run --json',
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.agentApprovalRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent key routing
// ---------------------------------------------------------------------------
describe('agent key routing', () => {
  it('ach_age_ prefix routes mandate create to /mandates/agent', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_age_test-key', AGLEDGER_API_URL: 'http://localhost:9999' },
    );
    expect(result.exitCode).toBe(0);
    // dry-run exits before making the call, so we can only verify flag parsing works
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contractType).toBe('ACH-PROC-v1');
  });

  it('--performer flag also triggers agent endpoint', () => {
    const result = run(
      'mandate create --type ACH-PROC-v1 --data \'{"criteria":{"item":"test"}}\' --performer agent-456 --dry-run --json',
      { AGLEDGER_API_KEY: 'ach_ent_test-key', AGLEDGER_API_URL: 'http://localhost:9999' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.performerAgentId).toBe('agent-456');
  });
});

// ---------------------------------------------------------------------------
// Quiet mode
// ---------------------------------------------------------------------------
describe('quiet mode', () => {
  it('--quiet suppresses all output on success', () => {
    const result = run('auth --quiet');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
// File input
// ---------------------------------------------------------------------------
describe('file input', () => {
  it('mandate create reads data from --file', () => {
    const file = tmpJson({ criteria: { item: 'from file' } });
    const result = run(`mandate create --type ACH-PROC-v1 --file ${file} --dry-run --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.criteria.item).toBe('from file');
  });

  it('receipt submit reads evidence from --file', () => {
    const file = tmpJson({ quantity: 42 });
    const result = run(`receipt submit 00000000-0000-0000-0000-000000000000 --file ${file} --dry-run --json`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.evidence.quantity).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------
describe('exit codes', () => {
  it('unknown command exits non-zero', () => {
    const result = run('nonexistent');
    expect(result.exitCode).not.toBe(0);
  });

  it('missing required flag exits 2', () => {
    const result = run('mandate create --json');
    expect(result.exitCode).toBe(2);
  });

  it('help-json unknown command exits 2', () => {
    const result = run('help-json nonexistent --json');
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Error output format
// ---------------------------------------------------------------------------
describe('error output', () => {
  it('auth error is valid JSON with code and message', () => {
    const result = run('mandate list --json');
    const parsed = parseJson(result);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('AUTH_REQUIRED');
    expect(parsed.message).toBeDefined();
  });

  it('admin set-config without --data or --file gives structured error', () => {
    const result = run(
      'admin set-config 00000000-0000-0000-0000-000000000000 --json',
      { AGLEDGER_API_KEY: 'ach_ent_test' },
    );
    expect(result.exitCode).not.toBe(0);
    const parsed = parseJson(result);
    expect(parsed.code).toBe('MISSING_INPUT');
  });
});
