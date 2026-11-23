import { allFlags, type CliConfig, type CommandClass } from './command.js';
import type { FlagDef } from './flags.js';

function width(): number {
  const columns = process.stdout.columns || Number(process.env.COLUMNS) || 80;
  return Math.min(Math.max(columns, 40), 100);
}

/** Wrap text to `max` columns; continuation lines start with `indent`. */
function wrap(text: string, max: number, indent: string, first = indent): string {
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > max) {
      lines.push(line);
      line = indent;
      empty = true;
    }
    line += (empty ? '' : ' ') + word;
    empty = false;
  }
  lines.push(line);
  return lines.join('\n');
}

/** Rows of `name  description`, with the descriptions aligned and wrapped. */
function table(rows: readonly (readonly [string, string])[], indent: string): string {
  const max = width();
  const pad = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows
    .map(([name, text]) => {
      const gap = ' '.repeat(pad - name.length);
      return wrap(text, max, indent + ' '.repeat(pad), `${indent}${name}${gap}`);
    })
    .join('\n');
}

function visible(flags: Record<string, FlagDef>): [string, FlagDef][] {
  return Object.entries(flags).filter(([, def]) => !def.hidden);
}

function flagUsage(name: string, def: FlagDef): string {
  const long = def.type === 'boolean' ? `--${name}` : `--${name} <value>`;
  const short = def.char ? (def.type === 'boolean' ? `-${def.char}` : `-${def.char} <value>`) : undefined;
  const repeat = def.type === 'option' && def.multiple ? '...' : '';
  return `[${short ?? long}${repeat}]`;
}

function usageLine(bin: string, id: string, command: CommandClass): string {
  if (command.usage) return wrap(command.usage, width(), '    ', `  $ ${bin} `);
  const args = Object.entries(command.args ?? {}).map(([name, def]) =>
    def.required ? name.toUpperCase() : `[${name.toUpperCase()}]`,
  );
  const flags = visible(allFlags(command)).map(([name, def]) => flagUsage(name, def));
  return wrap([id, ...args, ...flags].join(' '), width(), '    ', `  $ ${bin} `);
}

function flagHeading(name: string, def: FlagDef): string {
  const long = def.type === 'boolean' ? `--${name}` : `--${name}=<value>${def.multiple ? '...' : ''}`;
  return def.char ? `-${def.char}, ${long}` : long;
}

function flagNotes(def: FlagDef): string {
  const notes: string[] = [];
  if (def.type === 'option') {
    if (def.env) notes.push(`[env: ${def.env}]`);
    if (def.default !== undefined) notes.push(`[default: ${def.default}]`);
    if (def.options) notes.push(`(${def.options.join('|')})`);
  }
  return notes.join(' ');
}

/** `agledger <command> --help`. */
export function commandHelp(config: CliConfig, id: string, command: CommandClass): string {
  const sections: string[] = [];
  if (command.description) sections.push(wrap(command.description, width(), ''));
  sections.push(`USAGE\n${usageLine(config.bin, id, command)}`);

  const args = Object.entries(command.args ?? {});
  if (args.length > 0) {
    const rows = args.map(([name, def]): [string, string] => [
      def.required ? name.toUpperCase() : `[${name.toUpperCase()}]`,
      [def.options ? `(${def.options.join('|')})` : '', def.description ?? ''].filter(Boolean).join(' '),
    ]);
    sections.push(`ARGUMENTS\n${table(rows, '  ')}`);
  }

  const flags = visible(allFlags(command)).sort(([a], [b]) => a.localeCompare(b));
  if (flags.length > 0) {
    const body = flags.map(([name, def]) => {
      const text = [flagNotes(def), def.description ?? ''].filter(Boolean).join(' ');
      return `  ${flagHeading(name, def)}\n${wrap(text, width(), '      ')}`;
    });
    sections.push(`FLAGS\n${body.join('\n\n')}`);
  }

  if (command.examples && command.examples.length > 0) {
    sections.push(`EXAMPLES\n${command.examples.map((example) => `  $ ${example}`).join('\n\n')}`);
  }
  return sections.join('\n\n') + '\n';
}

/** `agledger --help`: the package description and every command. */
export function rootHelp(config: CliConfig, commands: Record<string, CommandClass>): string {
  const rows = Object.entries(commands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, command]): [string, string] => [id, command.description ?? '']);
  return (
    [
      wrap(config.description, width(), ''),
      `VERSION\n  ${versionLine(config)}`,
      `USAGE\n  $ ${config.bin} [COMMAND]`,
      `COMMANDS\n${table(rows, '  ')}`,
    ].join('\n\n') + '\n'
  );
}

export function versionLine(config: CliConfig): string {
  return `${config.name}/${config.version} ${process.platform}-${process.arch} node-${process.version}`;
}
