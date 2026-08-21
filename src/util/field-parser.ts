/**
 * Parses `-F/--field` and `-f/--raw-field` flag values into a nested object.
 *
 * Conventions (modeled on `gh api`, which has the same two flags):
 * - `key=value`            → { key: "value" }
 * - `key=true|false|null`  → typed literal          (`-F` only)
 * - `key=42` / `key=3.14`  → number                 (`-F` only)
 * - `key=[...]` / `key={...}` → JSON-parsed array/object  (`-F` only)
 * - `a.b.c=value`          → nested: { a: { b: { c: "value" } } }
 * - `arr[]=a arr[]=b`      → { arr: ["a", "b"] }
 * - `items[].name=x`       → { items: [{ name: "x" }] }  (appends new element)
 *
 * A raw field takes its value as a string, always. Path syntax is identical;
 * only the value side differs.
 *
 * Why both: the Server stopped coercing JSON bodies, so a field declared
 * `string` refuses a number. `publisher`, `platformRef`, `projectRef`,
 * `externalTaskId` and `correlationId` are plain strings carrying identifiers
 * minted by other systems, which are frequently all digits, and `-F id=4821`
 * types that as a number and is refused. There was no `-F` form that produced
 * the four characters: quoting reached the Server as a string with the quote
 * marks inside it, which the Server accepts, so the nearest workaround
 * notarized a corrupted identifier into a signed, immutable Record. `-f`
 * is the correct one-character answer.
 *
 * Why dot is nesting, not a literal: the AGLedger API uses camelCase / snake_case
 * throughout and has zero property keys containing '.', verified by scanning openapi.json.
 * If the API ever introduces one, we'll need to add an escape syntax (e.g. `a\.b=v`).
 *
 * If no `=` is present, throws; callers decide how to surface the error.
 */
export class FieldParseError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'FieldParseError';
  }
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === '') return '';
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  // JSON literals only if clearly bracketed, which avoids misinterpreting strings.
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through: treat as string if JSON parse fails.
    }
  }
  return raw;
}

/**
 * Split a field path into segments. Supports dot-separated nesting and `[]` array-append.
 * Returns segments like `['a', 'b', '[]', 'c']`.
 */
function splitPath(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      if (current) segments.push(current);
      current = '';
      i++;
    } else if (ch === '[' && path[i + 1] === ']') {
      if (current) segments.push(current);
      segments.push('[]');
      current = '';
      i += 2;
    } else {
      current += ch;
      i++;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function assignNested(target: Record<string, unknown>, segments: string[], value: unknown, originalField: string): void {
  let cursor: unknown = target;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const nextSeg = segments[i + 1];

    if (seg === '[]') {
      if (!Array.isArray(cursor)) {
        throw new FieldParseError(originalField, `path segment '[]' expects an array but parent is not an array`);
      }
      if (isLast) {
        cursor.push(value);
        return;
      }
      // Appending new element to build nested structure within.
      const newElement: unknown = nextSeg === '[]' ? [] : {};
      cursor.push(newElement);
      cursor = newElement;
      continue;
    }

    if (typeof cursor !== 'object' || cursor === null) {
      throw new FieldParseError(originalField, `cannot set '${seg}' on a non-object parent`);
    }
    const obj = cursor as Record<string, unknown>;

    if (isLast) {
      obj[seg] = value;
      return;
    }

    if (obj[seg] === undefined) {
      obj[seg] = nextSeg === '[]' ? [] : {};
    }
    cursor = obj[seg];
  }
}

/** One `key=value` entry, and whether its value side gets typed. */
export interface FieldInput {
  value: string;
  /** `-F` typed, `-f` verbatim string. */
  coerce: boolean;
}

/**
 * Parse `-F` and `-f` flag values into a single nested object.
 * Repeated paths merge; later values override earlier ones (except for `[]` which appends).
 *
 * Both flags parse in one call so their paths build one tree: `-F a.b=1 -f a.c=2`
 * has to land as `{a: {b: 1, c: "2"}}`, and parsing them separately would produce
 * two objects whose shallow merge drops one of the two `a` branches.
 *
 * A bare string means `-F`, so existing callers keep the typed behaviour.
 */
export function parseFields(fields: Array<string | FieldInput>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of fields) {
    const field = typeof entry === 'string' ? entry : entry.value;
    const coerce = typeof entry === 'string' ? true : entry.coerce;
    const eq = field.indexOf('=');
    if (eq === -1) {
      throw new FieldParseError(field, `missing '=': use key=value, not just '${field}'`);
    }
    const path = field.slice(0, eq);
    const rawValue = field.slice(eq + 1);
    if (!path) {
      throw new FieldParseError(field, `field path is empty before '='`);
    }
    const segments = splitPath(path);
    assignNested(result, segments, coerce ? coerceValue(rawValue) : rawValue, field);
  }
  return result;
}
