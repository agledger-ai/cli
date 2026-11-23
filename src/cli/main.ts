import { readFileSync } from 'node:fs';
import { type CliConfig, type CommandClass, ExitError } from './command.js';
import { commandHelp, rootHelp, versionLine } from './help.js';
import { UsageError } from './parse.js';

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

/**
 * The entry point: `--version`, `--help`, command lookup and dispatch. Exit
 * codes: a command's own through `exit()`, 2 for a command line the parser
 * refuses or a command that does not exist, 1 for anything unexpected.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const config = loadConfig();
  const quiet = argv.includes('--quiet');
  const first = argv[0];

  if (first === '--version') {
    process.stdout.write(`${versionLine(config)}\n`);
    return;
  }

  const terminator = argv.indexOf('--');
  const wantsHelp = (terminator === -1 ? argv : argv.slice(0, terminator)).includes('--help');
  // `agledger --help api` names the command after the flag; a bare `agledger` or
  // `agledger --help` names none and gets the root help.
  const commandId = first?.startsWith('-') ? argv.find((a) => Object.hasOwn(COMMANDS, a)) : first;

  if (commandId === undefined) {
    if (first !== undefined && !wantsHelp) {
      if (!quiet) process.stderr.write(commandNotFound(first) + '\n');
      finish(2);
      return;
    }
    const commands = Object.fromEntries(
      await Promise.all(
        Object.keys(COMMANDS).map(async (name) => [name, await loadCommand(name)] as const),
      ),
    );
    process.stdout.write(rootHelp(config, commands as Record<string, CommandClass>));
    return;
  }

  const command = await loadCommand(commandId);
  if (command === undefined) {
    if (!quiet) process.stderr.write(commandNotFound(commandId) + '\n');
    finish(2);
    return;
  }

  if (wantsHelp) {
    process.stdout.write(commandHelp(config, commandId, command));
    return;
  }

  try {
    await new command(argv.slice(1), config).run();
  } catch (err) {
    if (err instanceof ExitError) {
      if (err.exitCode !== 0) finish(err.exitCode);
      return;
    }
    if (err instanceof UsageError) {
      if (!quiet) {
        process.stderr.write(
          JSON.stringify({
            error: true,
            code: 'USAGE_ERROR',
            message: err.message,
            suggestion: `Run \`agledger ${commandId} --help\` to see usage.`,
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
