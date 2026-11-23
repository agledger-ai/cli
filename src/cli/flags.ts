/**
 * Flag and argument definitions for the CLI's commands. A definition is plain
 * data: `parse.ts` reads it to turn argv into typed values and `help.ts` reads
 * it to render `--help`, so a flag is described once.
 */

/** A flag that takes a value (`--name value`, `--name=value`, `-n value`). */
export interface OptionFlag {
  readonly type: 'option';
  readonly description?: string;
  /** One-letter alias, used as `-F`. */
  readonly char?: string;
  /** Repeatable: every occurrence is collected into an array. */
  readonly multiple?: boolean;
  /**
   * With `multiple`: take only the next argument per occurrence. Without it,
   * a repeatable flag also takes the positional arguments that follow it.
   */
  readonly multipleNonGreedy?: boolean;
  /** Environment variable that supplies the value when the flag is absent. */
  readonly env?: string;
  readonly default?: string;
  readonly hidden?: boolean;
  readonly required?: boolean;
  /** Accepted values; anything else is a usage error. */
  readonly options?: readonly string[];
}

/** A flag that takes no value. Absent means false. */
export interface BooleanFlag {
  readonly type: 'boolean';
  readonly description?: string;
  readonly char?: string;
  readonly default?: boolean;
  readonly hidden?: boolean;
}

export type FlagDef = OptionFlag | BooleanFlag;

/** A positional argument. Positionals are matched in declaration order. */
export interface ArgDef {
  readonly description?: string;
  readonly required?: boolean;
  readonly options?: readonly string[];
}

export const Flags = {
  string: <const O extends Omit<OptionFlag, 'type'>>(opts?: O): O & { readonly type: 'option' } =>
    ({ ...opts, type: 'option' }) as O & { readonly type: 'option' },
  boolean: <const O extends Omit<BooleanFlag, 'type'>>(opts?: O): O & { readonly type: 'boolean' } =>
    ({ ...opts, type: 'boolean' }) as O & { readonly type: 'boolean' },
};

export const Args = {
  string: <const O extends ArgDef>(opts?: O): O => ({ ...opts }) as O,
};

type OptionValue<F> = F extends { multiple: true }
  ? F extends { default: string } | { required: true }
    ? string[]
    : string[] | undefined
  : F extends { default: string } | { required: true }
    ? string
    : string | undefined;

/** The value a parsed flag takes, from its definition. */
export type FlagValue<F> = F extends { type: 'boolean' } ? boolean : OptionValue<F>;

export type ParsedFlags<D extends Record<string, FlagDef>> = { [K in keyof D]: FlagValue<D[K]> };

export type ParsedArgs<D extends Record<string, ArgDef>> = {
  [K in keyof D]: D[K] extends { required: true } ? string : string | undefined;
};
