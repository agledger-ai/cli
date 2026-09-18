/**
 * Profile storage at ~/.agledger/config.json. Credential-sensitive: directory 0700,
 * file 0600, chmodSync belt-and-braces for pre-existing files.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Where `agledger login --oidc` finds an OIDC token. The source is stored,
 * never a token, cert or key: each exchange calls the source again, because
 * the Server accepts a token id only once.
 */
export interface OidcProfileSource {
  tokenCommand?: string;
  tokenFile?: string;
  agentId?: string;
}

/** A profile holds an API key or an OIDC token source. */
export interface Profile {
  apiKey?: string;
  apiUrl?: string;
  oidc?: OidcProfileSource;
}

export interface Config {
  profiles: Record<string, Profile>;
  activeProfile?: string;
}

export function configDir(): string {
  return join(homedir(), '.agledger');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function readConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return { profiles: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      profiles: parsed.profiles ?? {},
      activeProfile: parsed.activeProfile,
    };
  } catch {
    return { profiles: {} };
  }
}

export function writeConfig(config: Config): void {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}
