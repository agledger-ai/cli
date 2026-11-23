import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/cli/main.js';
import { UsageError, parse } from '../src/cli/parse.js';
import { Args, Flags } from '../src/cli/flags.js';

describe('command registry', () => {
  it('names every file in src/commands, and nothing else', () => {
    const files = readdirSync(join(import.meta.dirname, '../src/commands'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.slice(0, -3));
    expect(Object.keys(COMMANDS).sort()).toEqual(files.sort());
  });
});

describe('parse', () => {
  const args = { a: Args.string({ required: true }) };
  const flags = {
    field: Flags.string({ char: 'F', multiple: true }),
    one: Flags.string({ multiple: true, multipleNonGreedy: true }),
    data: Flags.string({}),
    on: Flags.boolean({ default: false }),
  };

  it('takes short flags, clusters and an option value that starts with a dash', () => {
    const r = parse(['x', '-Fa=1', '-F', 'b=2', '--data', '-1'], args, flags);
    expect(r.args).toEqual({ a: 'x' });
    expect(r.flags.field).toEqual(['a=1', 'b=2']);
    expect(r.flags.data).toBe('-1');
    expect(r.flags.on).toBe(false);
  });

  it('lets a repeatable flag take the bare values after it unless it is non-greedy', () => {
    expect(parse(['x', '-F', 'a=1', 'b=2'], args, flags).flags.field).toEqual(['a=1', 'b=2']);
    expect(() => parse(['x', '--one', 'a', 'b'], args, flags)).toThrow(UsageError);
  });

  it('refuses unknown flags, missing values and arguments', () => {
    expect(() => parse(['x', '--nope'], args, flags)).toThrow('Nonexistent flag: --nope');
    expect(() => parse(['x', '--data'], args, flags)).toThrow('expects a value');
    expect(() => parse([], args, flags)).toThrow('Missing 1 required arg');
    expect(() => parse(['x', '--on=1'], args, flags)).toThrow('does not take a value');
  });
});
