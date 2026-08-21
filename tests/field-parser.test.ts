import { describe, it, expect } from 'vitest';
import { parseFields, FieldParseError } from '../src/util/field-parser.js';

describe('field-parser', () => {
  it('parses strings, booleans, null, numbers', () => {
    expect(parseFields(['k=v'])).toEqual({ k: 'v' });
    expect(parseFields(['k=true', 'k2=false', 'k3=null'])).toEqual({ k: true, k2: false, k3: null });
    expect(parseFields(['n=42', 'f=3.14', 'neg=-7'])).toEqual({ n: 42, f: 3.14, neg: -7 });
  });

  it('keeps version-like strings as strings, not partial numbers', () => {
    expect(parseFields(['version=1.2.3'])).toEqual({ version: '1.2.3' });
  });

  it('parses empty string', () => {
    expect(parseFields(['k='])).toEqual({ k: '' });
  });

  it('parses JSON literals for {...} and [...]', () => {
    expect(parseFields(['obj={"a":1}'])).toEqual({ obj: { a: 1 } });
    expect(parseFields(['arr=[1,2,3]'])).toEqual({ arr: [1, 2, 3] });
  });

  it('keeps invalid JSON literal as raw string', () => {
    expect(parseFields(['obj={not-json}'])).toEqual({ obj: '{not-json}' });
  });

  it('builds nested objects via dot syntax', () => {
    expect(parseFields(['a.b.c=x'])).toEqual({ a: { b: { c: 'x' } } });
  });

  it('appends to arrays via [] syntax', () => {
    expect(parseFields(['tags[]=a', 'tags[]=b', 'tags[]=c'])).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('combines nested and array append', () => {
    expect(parseFields(['items[].name=A', 'items[].name=B'])).toEqual({
      items: [{ name: 'A' }, { name: 'B' }],
    });
  });

  it('merges multiple fields into one object', () => {
    expect(parseFields(['contractType=notarize-generic-v1', 'criteria.item_spec=widgets', 'criteria.quantity.target=500'])).toEqual({
      contractType: 'notarize-generic-v1',
      criteria: { item_spec: 'widgets', quantity: { target: 500 } },
    });
  });

  it('later same-path wins for non-array', () => {
    expect(parseFields(['k=a', 'k=b'])).toEqual({ k: 'b' });
  });

  it('throws FieldParseError when = is missing', () => {
    expect(() => parseFields(['broken'])).toThrow(FieldParseError);
  });

  it('throws when path is empty', () => {
    expect(() => parseFields(['=value'])).toThrow(FieldParseError);
  });

  describe('raw fields (-f)', () => {
    const raw = (value: string) => ({ value, coerce: false });

    it('keeps a digit-only identifier a string', () => {
      // The whole point: the Server no longer coerces a JSON body, and these
      // fields are declared `string`, so -F sends a number and gets a 400.
      expect(parseFields([raw('externalTaskId=4821')])).toEqual({ externalTaskId: '4821' });
      expect(parseFields([raw('correlationId=00123')])).toEqual({ correlationId: '00123' });
    });

    it('does not eat the quote characters, which is what the -F workaround did', () => {
      // `-F id='"4821"'` reached the Server as a string with the quotes inside
      // it, which the Server accepts, notarizing a corrupted identifier.
      expect(parseFields([raw('externalTaskId=4821')])).toEqual({ externalTaskId: '4821' });
      expect(parseFields([raw('externalTaskId="4821"')])).toEqual({ externalTaskId: '"4821"' });
    });

    it('takes literals and JSON verbatim too', () => {
      expect(parseFields([raw('k=true'), raw('n=42'), raw('o={"a":1}')])).toEqual({
        k: 'true',
        n: '42',
        o: '{"a":1}',
      });
    });

    it('supports the same path syntax as -F', () => {
      expect(parseFields([raw('a.b.c=9')])).toEqual({ a: { b: { c: '9' } } });
      expect(parseFields([raw('arr[]=1'), raw('arr[]=2')])).toEqual({ arr: ['1', '2'] });
    });

    it('shares one tree with -F on a common branch', () => {
      // Parsing the two flags separately produced two objects whose shallow
      // merge dropped one of the `criteria` branches.
      expect(parseFields(['criteria.count=7', raw('criteria.ref=0042')])).toEqual({
        criteria: { count: 7, ref: '0042' },
      });
    });

    it('still throws on a malformed entry', () => {
      expect(() => parseFields([raw('broken')])).toThrow(FieldParseError);
      expect(() => parseFields([raw('=value')])).toThrow(FieldParseError);
    });
  });
});
