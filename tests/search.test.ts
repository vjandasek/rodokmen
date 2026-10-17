import { describe, expect, it } from 'vitest';
import type { FamilyFile, Person } from '../src/model.ts';
import { normalize, searchPeople } from '../src/search.ts';

function person(id: number, firstName: string, lastName: string | null, extra: Partial<Person> = {}): Person {
  return {
    id, firstName, lastName, maidenName: null, sex: 'M', living: true, bloodRelated: true,
    parentBlood: null, parentNotBlood: null, partners: [], ...extra,
  };
}

/** Root 1 + partner 2 (maiden name); children 3 and 4; 3 has partner 5. Made-up names. */
const FILE: FamilyFile = {
  version: 2,
  rootId: 1,
  people: [
    person(1, 'Bohumil', 'Kovář', { partners: [{ id: 2, married: true, order: 0 }] }),
    person(2, 'Růžena', 'Kovářová', { sex: 'F', bloodRelated: false, maidenName: 'Šťastná' }),
    person(3, 'Bohumila', 'Kovářová', { sex: 'F', parentBlood: 1, parentNotBlood: 2, bornDate: '01.02.1960', partners: [{ id: 5, married: true, order: 0 }] }),
    person(4, 'Bohumil', 'Kovář', { parentBlood: 1, parentNotBlood: 2 }),
    person(5, 'Kvido', 'Novák', { bloodRelated: false }),
  ],
};

const ids = (q: string) => searchPeople(FILE, q).map((h) => h.id);

describe('search', () => {
  it('normalizes accents and case', () => {
    expect(normalize('Šťastná Růžena')).toBe('stastna ruzena');
  });

  it('ignores accents, matches word starts, every typed word must match', () => {
    expect(ids('kovar')).toEqual(ids('KOVÁŘ'));
    expect(ids('kovar').sort()).toEqual([1, 2, 3, 4]);
    expect(ids('ruz')).toEqual([2]);
    expect(ids('bohumil kov')).toEqual([1, 4, 3]);
    expect(ids('ovar')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('ranks whole-word matches first ("bohumil" before "bohumila")', () => {
    expect(ids('bohumil')).toEqual([1, 4, 3]);
  });

  it('finds maiden names and partners', () => {
    expect(ids('stastna')).toEqual([2]);
    expect(ids('novak')).toEqual([5]);
  });

  it('details tell people of the same name apart', () => {
    const hits = searchPeople(FILE, 'bohumil');
    expect(hits[0]).toEqual({ id: 1, name: 'Bohumil Kovář', detail: '' });
    expect(hits[1]).toEqual({ id: 4, name: 'Bohumil Kovář', detail: 'syn: Bohumil a Růžena' });
    expect(hits[2].detail).toBe('dcera: Bohumil a Růžena · nar. 1960');
    expect(searchPeople(FILE, 'ruzena')[0].detail).toBe('roz. Šťastná · partnerka: Bohumil Kovář');
    expect(searchPeople(FILE, 'kvido')[0].detail).toBe('partner: Bohumila Kovářová');
  });

  it('limits the number of hits', () => {
    expect(searchPeople(FILE, 'k', 2)).toHaveLength(2);
  });
});
