import { parse } from './parse.js';
import type { ArgDef, FlagDef, ParsedArgs, ParsedFlags } from './flags.js';

/** What a command needs to know about the program it runs in. */
export interface CliConfig {
  /** The executable name, as the usage lines print it. */
  readonly bin: string;
  /** The package name. */
  readonly name: string;
  readonly version: string;
  /** The package description, printed at the top of the root help. */
  readonly description: string;
}

/** Thrown by `exit()` to unwind to the entry point, which ends the process with the code. */
export class ExitError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super(`EEXIT: ${exitCode}`);
    this.name = 'ExitError';
    this.exitCode = exitCode;
  }
}

/** The static side of a command: what `parse` and `--help` read. */
export interface CommandClass {
  readonly description?: string;
  readonly examples?: readonly string[];
  /** A usage line that replaces the generated one. */
  readonly usage?: string;
  readonly args?: Record<string, ArgDef>;
  readonly flags?: Record<string, FlagDef>;
  readonly baseFlags?: Record<string, FlagDef>;
  new (argv: readonly string[], config: CliConfig): Command;
}

/** A command's flags: the base flags, then its own (which may redefine one in place). */
export function allFlags(command: {
  flags?: Record<string, FlagDef>;
  baseFlags?: Record<string, FlagDef>;
}): Record<string, FlagDef> {
  return { ...command.baseFlags, ...command.flags };
}

export abstract class Command {
  static description?: string;
  static examples?: readonly string[];
  static usage?: string;
  static args?: Record<string, ArgDef>;
  static flags?: Record<string, FlagDef>;
  /** Flags every command accepts, listed before the command's own. */
  static baseFlags?: Record<string, FlagDef>;

  constructor(
    protected readonly argv: readonly string[],
    readonly config: CliConfig,
  ) {}

  abstract run(): Promise<void>;

  /** Parse this invocation's argv against the command's own definitions. */
  protected parse<C extends { args?: Record<string, ArgDef>; flags?: Record<string, FlagDef>; baseFlags?: Record<string, FlagDef> }>(
    command: C,
  ): Promise<{
    args: ParsedArgs<NonNullable<C['args']>>;
    flags: ParsedFlags<NonNullable<C['baseFlags']> & NonNullable<C['flags']>>;
  }> {
    const { args, flags } = parse(this.argv, command.args ?? {}, allFlags(command));
    return Promise.resolve({
      args: args as ParsedArgs<NonNullable<C['args']>>,
      flags: flags as ParsedFlags<NonNullable<C['baseFlags']> & NonNullable<C['flags']>>,
    });
  }

  /** End the command with an exit code. Never returns. */
  protected exit(code = 0): never {
    throw new ExitError(code);
  }
}
