import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FamilyFile, Person } from '../src/model.ts';
import { displayName, personCard, yearsWord } from '../src/details.ts';

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

const file = (...people: Person[]): FamilyFile => ({ version: 2, rootId: people[0].id, people });
const TODAY = new Date(2026, 9, 17); // 17.10.2026
const rows = (f: FamilyFile, id: number) =>
  Object.fromEntries(personCard(f, id, TODAY).rows.map((r) => [r.label, r.value]));

describe('displayName', () => {
  it('joins title, first name and surname, skipping nulls', () => {
    expect(displayName(person(1, { title: 'Ing.', firstName: 'A', lastName: 'B' }))).toBe('Ing. A B');
    expect(displayName(person(1, { firstName: 'A' }))).toBe('A');
  });
  it('has no cross for the deceased (only the card name gets one)', () => {
    expect(displayName(person(1, { firstName: 'A', lastName: 'B', living: false }))).toBe('A B');
    expect(personCard(file(person(1, { firstName: 'A', lastName: 'B', living: false })), 1, TODAY).name).toBe('† A B');
  });
});

describe('personCard', () => {
  it('hides empty rows', () => {
    const card = personCard(file(person(1)), 1, TODAY);
    expect(card).toEqual({ name: 'P1', rows: [] });
  });

  it('shows details in the fixed order', () => {
    const p = person(1, {
      sex: 'F',
      maidenName: 'M',
      bornDate: '01.02.1950',
      bornPlace: 'X',
      deathDate: '03.04.2020',
      deathPlace: 'Y',
      living: false,
    });
    expect(personCard(file(p), 1, TODAY).rows).toEqual([
      { label: 'Rodné příjmení', value: 'M' },
      { label: 'Narození', value: '01.02.1950, X' },
      { label: 'Úmrtí', value: '03.04.2020, Y' },
      { label: 'Dožila se', value: '70 let' },
    ]);
  });

  it('shows date or place alone', () => {
    expect(rows(file(person(1, { bornPlace: 'X' })), 1)['Narození']).toBe('X');
    expect(rows(file(person(1, { living: false, deathDate: '01.01.2000' })), 1)['Úmrtí']).toBe(
      '01.01.2000',
    );
  });

  it('deceased without dates: no death row and no age (the cross in the name says it)', () => {
    expect(personCard(file(person(1, { living: false })), 1, TODAY).rows).toEqual([]);
    const f = person(1, { living: false, sex: 'F', bornDate: '01.01.1900' });
    expect(personCard(file(f), 1, TODAY).rows).toEqual([
      { label: 'Narození', value: '01.01.1900' },
    ]);
  });

  it('age of the living counts the birthday only once reached', () => {
    expect(rows(file(person(1, { bornDate: '17.10.1995' })), 1)['Věk']).toBe('31 let');
    expect(rows(file(person(1, { bornDate: '18.10.1995' })), 1)['Věk']).toBe('30 let');
    expect(rows(file(person(1, { bornDate: '16.11.1995' })), 1)['Věk']).toBe('30 let');
  });

  it('age at death uses "Dožil se" for men', () => {
    const p = person(1, { living: false, bornDate: '10.05.1900', deathDate: '09.05.1974' });
    expect(rows(file(p), 1)['Dožil se']).toBe('73 let');
  });

  it('no age row for bad or future dates', () => {
    expect(rows(file(person(1, { bornDate: '1995' })), 1)['Věk']).toBeUndefined();
    expect(rows(file(person(1, { bornDate: '01.01.2030' })), 1)['Věk']).toBeUndefined();
    const p = person(1, { living: false, bornDate: '01.01.2000', deathDate: '01.01.1990' });
    expect(rows(file(p), 1)['Dožil se']).toBeUndefined();
  });

  it('Czech plural of years', () => {
    expect([0, 1, 2, 4, 5, 21, 22].map((n) => `${n} ${yearsWord(n)}`)).toEqual([
      '0 let',
      '1 rok',
      '2 roky',
      '4 roky',
      '5 let',
      '21 let',
      '22 let',
    ]);
    expect(rows(file(person(1, { bornDate: '01.01.2024' })), 1)['Věk']).toBe('2 roky');
    expect(rows(file(person(1, { bornDate: '01.01.2025' })), 1)['Věk']).toBe('1 rok');
  });

  // Family: 1 (blood) married to 2 (F), then partner 3 (F, not married); children 4, 5 (of 2), 6 (of 3).
  const family = () =>
    file(
      person(1, {
        firstName: 'A',
        lastName: 'S',
        partners: [
          { id: 3, married: false, order: 1 },
          { id: 2, married: true, order: 0 },
        ],
      }),
      person(2, { firstName: 'B', lastName: 'S', sex: 'F', bloodRelated: false }),
      person(3, { firstName: 'C', lastName: 'T', sex: 'F', bloodRelated: false, living: false }),
      person(6, { firstName: 'F', lastName: 'T', parentBlood: 1, parentNotBlood: 3 }),
      person(5, { firstName: 'E', sex: 'F', parentBlood: 1, parentNotBlood: 2, living: false }),
      person(4, { firstName: 'D', lastName: 'S', parentBlood: 1, parentNotBlood: 2 }),
    );

  it('blood relative: partners in order with labels by their sex and marriage, children', () => {
    expect(personCard(family(), 1, TODAY).rows).toEqual([
      { label: 'Manželka', value: 'B S' },
      { label: 'Partnerka', value: 'C T' },
      { label: 'Děti', value: 'D, E, F' },
    ]);
  });

  it('partner: the blood relative as partner, own children via parentNotBlood, no parents', () => {
    expect(personCard(family(), 2, TODAY).rows).toEqual([
      { label: 'Manžel', value: 'A S' },
      { label: 'Děti', value: 'D, E' },
    ]);
    expect(personCard(family(), 3, TODAY)).toEqual({
      name: '† C T',
      rows: [
        { label: 'Partner', value: 'A S' },
        { label: 'Děti', value: 'F' },
      ],
    });
  });

  it('child: both parents, or just the blood parent', () => {
    const f = family();
    expect(rows(f, 4)['Rodiče']).toBe('A S a B S');
    f.people.push(person(7, { parentBlood: 1 }));
    expect(rows(f, 7)['Rodiče']).toBe('A S');
  });

  it('a partner who is male and married gets "Manžel"', () => {
    const f = file(
      person(1, { sex: 'F', partners: [{ id: 2, married: true, order: 0 }] }),
      person(2, { bloodRelated: false }),
    );
    expect(rows(f, 1)['Manžel']).toBe('P2');
    expect(rows(f, 2)['Manželka']).toBe('P1');
  });

  it('throws for an unknown id', () => {
    expect(() => personCard(family(), 99, TODAY)).toThrow();
  });
});

const DATA = new URL('../data/family.json', import.meta.url);

it.skipIf(!existsSync(DATA))('real data: a card for every person without throwing', () => {
  const data = JSON.parse(readFileSync(DATA, 'utf8')) as FamilyFile;
  for (const p of data.people) {
    const card = personCard(data, p.id, TODAY);
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.rows.every((r) => r.label && r.value)).toBe(true);
  }
});
