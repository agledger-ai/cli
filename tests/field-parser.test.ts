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
    expect(parseFields(['contractType=ACH-PROC-v1', 'criteria.item_spec=widgets', 'criteria.quantity.target=500'])).toEqual({
      contractType: 'ACH-PROC-v1',
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
});
