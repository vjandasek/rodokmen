import { describe, expect, it } from 'vitest';
import type { FamilyFile, Person } from '../src/model.ts';
import { stripForPublic, suspectDeceased } from '../src/strip.ts';
import { exportKey, importKey, normalizePassword, open, seal, vaultKey } from '../src/vault.ts';
import { findLeaks, fold, sensitiveTerms } from '../scripts/leaks.ts';

function person(id: number, extra: Partial<Person> = {}): Person {
  return {
    id,
    firstName: `P${id}`,
    lastName: null,
    maidenName: null,
    sex: 'M',
    living: true,
    bloodRelated: true,
    parentBlood: null,
    parentNotBlood: null,
    partners: [],
    title: null,
    bornDate: null,
    bornPlace: null,
    deathDate: null,
    deathPlace: null,
    ...extra,
  };
}

const details = { title: 'Ing.', bornDate: '14.07.1931', bornPlace: 'Kdesi', deathDate: '02.01.2001', deathPlace: 'Jinde' };

function family(): FamilyFile {
  return {
    version: 2,
    rootId: 1,
    familyName: 'Vzorovi',
    people: [
      person(1, { living: false, maidenName: 'Starší', ...details, partners: [{ id: 2, married: true, order: 0 }] }),
      person(2, { living: true, sex: 'F', lastName: 'Nová', maidenName: 'Stará', ...details, deathDate: null, deathPlace: null }),
      person(3, { living: true, sex: 'F', lastName: null, maidenName: 'Jediná', bornDate: '01.02.2003' }),
      person(4, { living: true, lastName: 'Same', maidenName: 'Same' }),
    ],
  };
}

describe('stripForPublic', () => {
  it('keeps everything of the deceased', () => {
    expect(stripForPublic(family()).people[0]).toEqual(family().people[0]);
  });
  it('leaves living people only their names', () => {
    const p = stripForPublic(family()).people[1];
    expect(p).toMatchObject({ firstName: 'P2', lastName: 'Nová', maidenName: null, title: null, bornDate: null, bornPlace: null });
    expect(p.partners).toEqual([]);
  });
  it('turns a maiden name into the surname when it is the only one', () => {
    expect(stripForPublic(family()).people[2]).toMatchObject({ lastName: 'Jediná', maidenName: null, bornDate: null });
    expect(stripForPublic(family()).people[3]).toMatchObject({ lastName: 'Same', maidenName: null });
  });
  it('does not change its input and keeps the family name inside the data', () => {
    const file = family();
    const stripped = stripForPublic(file);
    expect(file).toEqual(family());
    expect(stripped.familyName).toBe('Vzorovi');
    expect(stripped.people[0].partners).not.toBe(file.people[0].partners);
  });
});

describe('suspectDeceased', () => {
  it('lists the deceased without a death date born after 1930', () => {
    const file = family();
    file.people.push(
      person(5, { living: false, bornDate: '01.01.1950' }),
      person(6, { living: false, bornDate: '01.01.1920' }),
      person(7, { living: false }),
      person(8, { living: false, bornDate: '01.01.1950', deathDate: '01.01.2000' }),
    );
    expect(suspectDeceased(file).map((p) => p.id)).toEqual([5]);
  });
});

describe('vault', () => {
  const ITER = 1000;
  it('decrypts with the right password, forgiving case and spaces', async () => {
    const vault = await seal('{"a":"Příliš žluťoučký"}', 'Kůň skáče přes Plot', ITER);
    expect(vault.iterations).toBe(ITER);
    expect(await open(vault, await vaultKey(vault, '  kůň  skáče přes plot '))).toBe('{"a":"Příliš žluťoučký"}');
  });
  it('rejects a wrong password', async () => {
    const vault = await seal('secret', 'one two three four', ITER);
    await expect(open(vault, await vaultKey(vault, 'one two three five'))).rejects.toThrow();
  });
  it('uses a fresh salt and IV each time and keeps no plain text', async () => {
    const a = await seal('the same text', 'pw pw pw pw', ITER);
    const b = await seal('the same text', 'pw pw pw pw', ITER);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(JSON.stringify(a)).not.toContain('same');
  });
  it('remembers the key as text', async () => {
    const vault = await seal('x'.repeat(100_000), 'pw pw pw pw', ITER);
    const saved = await exportKey(await vaultKey(vault, 'pw pw pw pw'));
    expect(await open(vault, await importKey(saved))).toHaveLength(100_000);
  });
  it('normalizes the password', () => {
    expect(normalizePassword(' Ahoj\tSvěte ')).toBe('ahoj světe');
  });
});

describe('leak check', () => {
  const terms = sensitiveTerms(family());
  it('collects names, places, dates and the family name', () => {
    for (const t of ['nova', 'stara', 'jedina', 'kdesi', 'jinde', 'vzorovi', '14.07.1931', 'ing.']) expect(terms, t).toContain(t);
    // Words under 4 letters are too common to check.
    expect(terms).not.toContain('p2');
  });
  it('finds them as whole words, with or without diacritics', () => {
    expect(findLeaks('const a="Nova"', terms).map((l) => l.term)).toEqual(['nova']);
    expect(findLeaks('narozen 14.07.1931', terms).map((l) => l.term)).toEqual(['14.07.1931']);
    expect(findLeaks('novastara kdesix', terms)).toEqual([]);
  });
  it('ignores known library identifiers, but not the same word elsewhere', () => {
    const roman = new Set(['roman']);
    expect(findLeaks('case`lower-roman`: font times-roman', roman)).toEqual([]);
    expect(findLeaks('"Roman"', roman).map((l) => l.term)).toEqual(['roman']);
  });
  it('folds diacritics', () => {
    expect(fold('Žluťoučký Kůň')).toBe('zlutoucky kun');
  });
});
