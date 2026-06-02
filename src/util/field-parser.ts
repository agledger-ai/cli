/**
 * Parses `-F/--field` flag values into a nested object.
 *
 * Conventions (modeled on `gh api -F`):
 * - `key=value`            → { key: "value" }
 * - `key=true|false|null`  → typed literal
 * - `key=42` / `key=3.14`  → number
 * - `key=[...]` / `key={...}` → JSON-parsed array/object
 * - `a.b.c=value`          → nested: { a: { b: { c: "value" } } }
 * - `arr[]=a arr[]=b`      → { arr: ["a", "b"] }
 * - `items[].name=x`       → { items: [{ name: "x" }] }  (appends new element)
 *
 * Why: dot is nesting, not a literal. The AGLedger API uses camelCase / snake_case
 * throughout and has zero property keys containing '.' — verified by scanning openapi.json.
 * If the API ever introduces one, we'll need to add an escape syntax (e.g. `a\.b=v`).
 *
 * If no `=` is present, throws — callers decide how to surface the error.
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
  // JSON literals only if clearly bracketed — avoids misinterpreting strings.
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through — treat as string if JSON parse fails.
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

/**
 * Parse an array of `-F` flag values into a single nested object.
 * Repeated paths merge; later values override earlier ones (except for `[]` which appends).
 */
export function parseFields(fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const eq = field.indexOf('=');
    if (eq === -1) {
      throw new FieldParseError(field, `missing '=' — use key=value, not just '${field}'`);
    }
    const path = field.slice(0, eq);
    const rawValue = field.slice(eq + 1);
    if (!path) {
      throw new FieldParseError(field, `field path is empty before '='`);
    }
    const segments = splitPath(path);
    assignNested(result, segments, coerceValue(rawValue), field);
  }
  return result;
}
