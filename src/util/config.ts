/**
 * Profile storage at ~/.agledger/config.json. Credential-sensitive: directory 0700,
 * file 0600, both enforced on every write, not only when they are created.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  /** A JWK Set file each cert exchange adds its public key to (absolute). */
  agentKeysFile?: string;
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

/** The config file exists but cannot be read as a profile store. Never replaced silently. */
export class ConfigFileError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/** A profile by name, own entries only: `toString` and `__proto__` name no profile. */
export function getProfile(config: Config, name: string): Profile | undefined {
  return Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the stored profiles. A missing file is an empty store. A file that is
 * not valid JSON, or not the profile shape, throws: returning an empty store
 * there let the next `login` overwrite the file and lose every profile.
 */
export function readConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return { profiles: Object.create(null) as Record<string, Profile> };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new ConfigFileError(
      `The config file ${path} cannot be read: ${err instanceof Error ? err.message : String(err)}`,
      path,
    );
  }
  if (!isRecord(parsed) || (parsed.profiles !== undefined && !isRecord(parsed.profiles))) {
    throw new ConfigFileError(`The config file ${path} is not a profile store (expected an object with a "profiles" object).`, path);
  }
  const activeProfile = typeof parsed.activeProfile === 'string' ? parsed.activeProfile : undefined;
  return {
    profiles: Object.assign(Object.create(null) as Record<string, Profile>, parsed.profiles ?? {}),
    activeProfile,
  };
}

/** Write the store through a temp file in the same directory and a rename, so a crash never leaves half a file. */
export function writeConfig(config: Config): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The mode above applies only when the directory is created.
  chmodSync(dir, 0o700);
  const path = configPath();
  const temp = join(dir, `.config.json.${process.pid}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}
