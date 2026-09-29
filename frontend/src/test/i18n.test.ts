import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { es } from '@/i18n/es';

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ''): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
const vars = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();

describe('i18n dictionaries', () => {
  const E = flatten(es as unknown as Tree);
  const N = flatten(en as unknown as Tree);

  it('Spanish and English have exactly the same keys', () => {
    expect(Object.keys(N).sort()).toEqual(Object.keys(E).sort());
  });

  it('interpolation placeholders match in both languages', () => {
    const mismatched = Object.keys(E).filter((k) => JSON.stringify(vars(E[k])) !== JSON.stringify(vars(N[k] ?? '')));
    expect(mismatched).toEqual([]);
  });

  it('has no empty strings', () => {
    expect(Object.entries({ ...E, ...N }).filter(([, v]) => !v.trim())).toEqual([]);
  });
});
