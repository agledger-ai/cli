import { readFileSync } from 'node:fs';
import { allFlags, type CliConfig, type CommandClass, ExitError } from './command.js';
import type { FlagDef } from './flags.js';
import { ConfigFileError } from '../util/config.js';
import { commandHelp, rootHelp, versionLine } from './help.js';
import { UsageError, beforeTerminator } from './parse.js';

/**
 * Every command, loaded on demand so `agledger verify` does not pay for the
 * modules of the commands it does not run. `tests/commands.test.ts` holds
 * this list to the files in `src/commands`.
 */
export const COMMANDS: Record<string, () => Promise<{ default: CommandClass }>> = {
  api: () => import('../commands/api.js'),
  auth: () => import('../commands/auth.js'),
  config: () => import('../commands/config.js'),
  discover: () => import('../commands/discover.js'),
  docs: () => import('../commands/docs.js'),
  'help-json': () => import('../commands/help-json.js'),
  'list-commands': () => import('../commands/list-commands.js'),
  login: () => import('../commands/login.js'),
  logout: () => import('../commands/logout.js'),
  verify: () => import('../commands/verify.js'),
};

/** Load one command's class by id, or undefined for an id that names none. */
export async function loadCommand(id: string): Promise<CommandClass | undefined> {
  const load = Object.hasOwn(COMMANDS, id) ? COMMANDS[id] : undefined;
  return load ? (await load()).default : undefined;
}

export function loadConfig(): CliConfig {
  const pjson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string; description: string };
  return { bin: 'agledger', name: pjson.name, version: pjson.version, description: pjson.description };
}

/** Levenshtein distance, iterative two-row form. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const substitute = (previous[j] ?? 0) + (a[i] === b[j] ? 0 : 1);
      current.push(Math.min((current[j] ?? 0) + 1, (previous[j + 1] ?? 0) + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Closest command id, when it is close enough to be worth suggesting. */
function nearest(id: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(id.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Scale with the length of what was typed so short ids don't match everything.
  return best !== undefined && bestScore <= Math.max(2, Math.floor(id.length / 2)) ? best : undefined;
}

/**
 * Unknown commands printed only "command X not found", with no nearest match
 * and no pointer to how to find the real one. An agent that guessed a verb had
 * nothing to recover from, which matters here because the CLI deliberately has
 * few commands: almost everything goes through `agledger api`, and a wrong
 * guess is the expected first move.
 */
function commandNotFound(id: string): string {
  const suggestion = nearest(id, Object.keys(COMMANDS));
  const parts = [
    suggestion ? `Did you mean \`agledger ${suggestion}\`?` : undefined,
    'Run `agledger list-commands` to see every command.',
    // The real surface area is the API passthrough, not the command list.
    'Most operations go through `agledger api <METHOD> <PATH>`, which reaches every route.',
  ].filter(Boolean);
  return JSON.stringify({
    error: true,
    code: 'COMMAND_NOT_FOUND',
    message: `Command "${id}" not found.`,
    ...(suggestion ? { didYouMean: suggestion } : {}),
    suggestion: parts.join(' '),
  });
}

/** End the process once what was written to stdout and stderr has gone out. */
function finish(code: number): void {
  process.exitCode = code;
  process.stdout.write('', () => {
    process.stderr.write('', () => process.exit(code));
  });
}

/** Flags a user may type to ask for help, and the word that does the same. */
const HELP_WORD = 'help';

/**
 * Whether argv asks for help: `--help` or `-h` before any `--`, and not as the
 * value of a flag that takes one (`--data --help` sends the text `--help`).
 */
function requestsHelp(argv: readonly string[], flags: Record<string, FlagDef>): boolean {
  const takesValue = (name: string): boolean => flags[name]?.type === 'option';
  const byChar = new Map(Object.entries(flags).flatMap(([name, def]) => (def.char ? [[def.char, name] as const] : [])));
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token === '--') return false;
    if (token === '--help' || token === '-h') return true;
    if (token.startsWith('--')) {
      if (!token.includes('=') && takesValue(token.slice(2))) i++;
    } else if (token.length === 2 && token.startsWith('-')) {
      const name = byChar.get(token.slice(1));
      if (name !== undefined && takesValue(name)) i++;
    }
  }
  return false;
}

function writeUsageError(commandId: string, message: string): void {
  process.stderr.write(
    JSON.stringify({
      error: true,
      code: 'USAGE_ERROR',
      message,
      suggestion: `Run \`agledger ${commandId} --help\` to see usage.`,
    }) + '\n',
  );
}

/**
 * The entry point: `--version`, `--help`, command lookup and dispatch. Exit
 * codes: a command's own through `exit()`, 2 for a command line the parser
 * refuses or a command that does not exist, 1 for anything unexpected.
 *
 * Global flags may come before the command (`agledger --json api GET /health`):
 * the command is the first word that names one, and what surrounds it is the
 * command's own argv.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const config = loadConfig();
  const flagArgs = beforeTerminator(argv);
  const quiet = flagArgs.includes('--quiet');
  const first = argv[0];

  // A reader that closed the pipe (`| head -1`) has what it wanted.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  if (first === '--version') {
    process.stdout.write(`${versionLine(config)}\n`);
    return;
  }

  const isCommandWord = (a: string): boolean => Object.hasOwn(COMMANDS, a) || a === HELP_WORD;
  const index = first === undefined ? -1 : first.startsWith('-') ? flagArgs.findIndex(isCommandWord) : 0;
  const commandId = index === -1 ? undefined : argv[index];
  const rest = index === -1 ? [...argv] : [...argv.slice(0, index), ...argv.slice(index + 1)];
  const loadAll = async (): Promise<Record<string, CommandClass>> =>
    Object.fromEntries(
      await Promise.all(Object.keys(COMMANDS).map(async (name) => [name, (await loadCommand(name)) as CommandClass] as const)),
    );

  if (commandId === undefined) {
    // A bare `agledger` or `agledger --help` gets the root help; anything else names no command.
    if (first !== undefined && !requestsHelp(argv, {})) {
      if (!quiet) process.stderr.write(commandNotFound(first) + '\n');
      finish(2);
      return;
    }
    process.stdout.write(rootHelp(config, await loadAll()));
    return;
  }

  // `agledger help [command]`
  const target = commandId === HELP_WORD ? rest.find((a) => !a.startsWith('-')) : commandId;
  if (target === undefined) {
    process.stdout.write(rootHelp(config, await loadAll()));
    return;
  }

  const command = await loadCommand(target);
  if (command === undefined) {
    if (!quiet) process.stderr.write(commandNotFound(target) + '\n');
    finish(2);
    return;
  }

  if (commandId === HELP_WORD || requestsHelp(rest, allFlags(command))) {
    process.stdout.write(commandHelp(config, target, command));
    return;
  }

  try {
    await new command(rest, config).run();
  } catch (err) {
    if (err instanceof ExitError) {
      if (err.exitCode !== 0) finish(err.exitCode);
      return;
    }
    if (err instanceof UsageError) {
      if (!quiet) writeUsageError(commandId, err.message);
      finish(2);
      return;
    }
    if (err instanceof ConfigFileError) {
      if (!quiet) {
        process.stderr.write(
          JSON.stringify({
            error: true,
            code: 'CONFIG_ERROR',
            message: err.message,
            suggestion: `Fix or remove ${err.path}. It is never overwritten while it cannot be read, so the profiles in it are kept.`,
          }) + '\n',
        );
      }
      finish(2);
      return;
    }
    if (!quiet) {
      process.stderr.write(
        JSON.stringify({
          error: true,
          code: 'UNKNOWN_ERROR',
          message: err instanceof Error ? err.message : String(err),
        }) + '\n',
      );
    }
    finish(1);
  }
}
