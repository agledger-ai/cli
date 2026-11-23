import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { ArgDef, FlagDef } from './flags.js';

/** A command line the parser refuses: an unknown flag, a missing value or argument. */
export class UsageError extends Error {}

export interface ParseResult {
  args: Record<string, string | undefined>;
  flags: Record<string, string | string[] | boolean | undefined>;
}

/**
 * Turn argv into positional arguments and flags, as the definitions describe.
 *
 * Node's `parseArgs` does the tokenizing (long and short flags, `--flag=value`,
 * `-Fvalue`, the `--` terminator). It runs non-strict, with tokens, because the
 * strict mode refuses an option value that starts with a dash, such as
 * `--data -1`. Everything else (unknown flags, missing values, required
 * arguments, env fallbacks, defaults) is decided here.
 */
export function parse(
  argv: readonly string[],
  argDefs: Record<string, ArgDef>,
  flagDefs: Record<string, FlagDef>,
): ParseResult {
  const names = Object.keys(flagDefs);
  const byChar = new Map<string, string>();
  const config: ParseArgsOptionsConfig = {};
  for (const name of names) {
    const def = flagDefs[name];
    if (!def) continue;
    config[name] = {
      type: def.type === 'boolean' ? 'boolean' : 'string',
      ...(def.char ? { short: def.char } : {}),
    };
    if (def.char) byChar.set(def.char, name);
  }

  const { tokens } = parseArgs({
    args: [...argv],
    options: config,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });

  const flags: ParseResult['flags'] = {};
  const positionals: string[] = [];
  // The repeatable flag still taking bare values: `-F a=1 b=2` reads b=2 as a
  // second -F unless the flag is non-greedy. Only a flag that takes a value, or
  // the `--` terminator, ends it.
  let greedy: string | undefined;

  for (const token of tokens) {
    if (token.kind === 'option-terminator') {
      greedy = undefined;
      continue;
    }
    if (token.kind === 'positional') {
      if (greedy !== undefined) {
        (flags[greedy] as string[]).push(token.value);
      } else {
        positionals.push(token.value);
      }
      continue;
    }
    const rawName = token.rawName;
    const name = Object.hasOwn(flagDefs, token.name) ? token.name : byChar.get(token.name);
    const def = name === undefined ? undefined : flagDefs[name];
    if (name === undefined || def === undefined) {
      throw new UsageError(`Nonexistent flag: ${rawName}`);
    }
    if (def.type === 'boolean') {
      if (token.inlineValue === true) throw new UsageError(`Flag ${rawName} does not take a value`);
      flags[name] = true;
      continue;
    }
    if (token.value === undefined) throw new UsageError(`Flag ${rawName} expects a value`);
    if (def.options && !def.options.includes(token.value)) {
      throw new UsageError(`Expected ${token.value} to be one of: ${def.options.join(', ')}`);
    }
    if (def.multiple) {
      const list = (flags[name] as string[] | undefined) ?? [];
      list.push(token.value);
      flags[name] = list;
      greedy = def.multipleNonGreedy ? undefined : name;
    } else {
      flags[name] = token.value;
      greedy = undefined;
    }
  }

  for (const name of names) {
    const def = flagDefs[name];
    if (!def) continue;
    if (def.type === 'boolean') {
      flags[name] ??= def.default ?? false;
      continue;
    }
    if (flags[name] === undefined && def.env !== undefined) {
      const fromEnv = process.env[def.env];
      if (fromEnv !== undefined) flags[name] = def.multiple ? [fromEnv] : fromEnv;
    }
    if (flags[name] === undefined && def.default !== undefined) {
      flags[name] = def.multiple ? [def.default] : def.default;
    }
    if (flags[name] === undefined && def.required) {
      throw new UsageError(`Missing required flag ${name}`);
    }
  }

  const args: ParseResult['args'] = {};
  const argNames = Object.keys(argDefs);
  const missing: string[] = [];
  argNames.forEach((name, i) => {
    const def = argDefs[name];
    const value = positionals[i];
    if (value === undefined) {
      if (def?.required) missing.push(name);
      return;
    }
    if (def?.options && !def.options.includes(value)) {
      throw new UsageError(`Expected ${value} to be one of: ${def.options.join(', ')}`);
    }
    args[name] = value;
  });
  if (missing.length > 0) {
    throw new UsageError(`Missing ${missing.length} required arg${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
  const extra = positionals.slice(argNames.length);
  if (extra.length > 0) {
    throw new UsageError(`Unexpected argument${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}`);
  }
  return { args, flags };
}
