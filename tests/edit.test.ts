import { describe, expect, it } from 'vitest';
import type { FamilyFile, Person } from '../src/model.ts';
import {
  EditError,
  FamilyEditor,
  isValidDate,
  savedFileName,
  serialize,
  UNDO_LIMIT,
  type PersonDetails,
} from '../src/edit.ts';

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

/**
 * Root 1 with partners 2 (order 0) and 3 (order 1); children 4 (other parent 2) and 5 (unknown);
 * 4 has partner 6 and no children.
 */
function family(): FamilyFile {
  return {
    version: 2,
    rootId: 1,
    people: [
      person(1, { partners: [{ id: 2, married: true, order: 0 }, { id: 3, married: false, order: 1 }] }),
      person(2, { bloodRelated: false, sex: 'F' }),
      person(3, { bloodRelated: false, sex: 'F' }),
      person(4, { parentBlood: 1, parentNotBlood: 2, partners: [{ id: 6, married: true, order: 0 }] }),
      person(5, { parentBlood: 1 }),
      person(6, { bloodRelated: false, sex: 'F' }),
    ],
  };
}

function details(extra: Partial<PersonDetails> = {}): PersonDetails {
  return {
    firstName: 'New',
    lastName: null,
    maidenName: null,
    sex: 'F',
    living: true,
    title: null,
    bornDate: null,
    bornPlace: null,
    deathDate: null,
    deathPlace: null,
    ...extra,
  };
}

/** Expects `fn` to throw EditError and leave the editor's data and undo state unchanged. */
function expectRefused(ed: FamilyEditor, fn: () => unknown, message?: RegExp) {
  const before = serialize(ed.file);
  const dirty = ed.dirty;
  const canUndo = ed.canUndo();
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(EditError);
  if (message) expect((error as Error).message).toMatch(message);
  expect(serialize(ed.file)).toBe(before);
  expect(ed.dirty).toBe(dirty);
  expect(ed.canUndo()).toBe(canUndo);
}

describe('isValidDate', () => {
  it('accepts real dates in dd.mm.yyyy', () => {
    expect(isValidDate('15.03.1990')).toBe(true);
    expect(isValidDate('29.02.2024')).toBe(true);
    expect(isValidDate('29.02.2000')).toBe(true);
    expect(isValidDate('31.12.1900')).toBe(true);
  });
  it('rejects other formats and impossible dates', () => {
    for (const d of ['29.02.2023', '29.02.1900', '31.04.2000', '00.01.2000', '01.13.2000', '1.5.1995', '01.05.95', '01-05-1995', ' 01.05.1995', '']) {
      expect(isValidDate(d), d).toBe(false);
    }
  });
});

describe('serialize / savedFileName', () => {
  it('writes 2-space JSON with a trailing newline', () => {
    const f = family();
    expect(serialize(f)).toBe(JSON.stringify(f, null, 2) + '\n');
    expect(serialize(f).startsWith('{\n  "version": 2,')).toBe(true);
  });
  it('names saved copies by local time, zero-padded', () => {
    expect(savedFileName(new Date(2026, 0, 5, 7, 3))).toBe('family-2026-01-05_0703.json');
    expect(savedFileName(new Date(2026, 11, 31, 23, 59))).toBe('family-2026-12-31_2359.json');
  });
});

describe('FamilyEditor', () => {
  it('does not mutate the input file', () => {
    const f = family();
    const before = serialize(f);
    const ed = new FamilyEditor(f);
    ed.updatePerson(5, { firstName: 'Changed' });
    expect(serialize(f)).toBe(before);
  });

  it('lookups: person, partnerOf, partners in order', () => {
    const ed = new FamilyEditor(family());
    expect(ed.person(4).id).toBe(4);
    expect(() => ed.person(99)).toThrow(EditError);
    expect(ed.partnerOf(6)?.id).toBe(4);
    expect(ed.partnerOf(5)).toBeNull();
    expect(ed.partners(1).map((p) => p.id)).toEqual([2, 3]);
  });

  it('updatePerson trims, turns empty text into null and keeps key order', () => {
    const ed = new FamilyEditor(family());
    ed.updatePerson(5, { firstName: '  A ', lastName: '  ', bornDate: '01.02.2003', bornPlace: ' X ', living: false });
    const p = ed.person(5);
    expect(p.firstName).toBe('A');
    expect(p.lastName).toBeNull();
    expect(p.bornDate).toBe('01.02.2003');
    expect(p.bornPlace).toBe('X');
    expect(p.living).toBe(false);
    expect(Object.keys(p)).toEqual(Object.keys(person(0)));
    expect(ed.dirty).toBe(true);
  });

  it('updatePerson refuses an empty name and invalid dates', () => {
    const ed = new FamilyEditor(family());
    expectRefused(ed, () => ed.updatePerson(5, { firstName: '   ' }), /Jméno je povinné/);
    expectRefused(ed, () => ed.updatePerson(5, { bornDate: '29.02.2023' }), /Datum narození musí být ve tvaru dd\.mm\.rrrr/);
    expectRefused(ed, () => ed.updatePerson(5, { deathDate: '1.1.2000' }), /Datum úmrtí/);
    expectRefused(ed, () => ed.updatePerson(99, { firstName: 'A' }));
  });

  it('setMarried', () => {
    const ed = new FamilyEditor(family());
    ed.setMarried(1, 3, true);
    expect(ed.person(1).partners.find((r) => r.id === 3)?.married).toBe(true);
    expectRefused(ed, () => ed.setMarried(1, 6, true));
  });

  it('addPartner appends a non-blood partner with the next id', () => {
    const ed = new FamilyEditor(family());
    const id = ed.addPartner(5, details({ lastName: ' L ' }), true);
    expect(id).toBe(7);
    const p = ed.person(7);
    expect(p).toMatchObject({ bloodRelated: false, parentBlood: null, parentNotBlood: null, partners: [], lastName: 'L' });
    expect(Object.keys(p)).toEqual(Object.keys(person(0)));
    expect(ed.person(5).partners).toEqual([{ id: 7, married: true, order: 0 }]);
    const id2 = ed.addPartner(1, details(), false);
    expect(ed.person(1).partners.map((r) => [r.id, r.order])).toEqual([[2, 0], [3, 1], [id2, 2]]);
  });

  it('addPartner refuses a partner as owner and bad details', () => {
    const ed = new FamilyEditor(family());
    expectRefused(ed, () => ed.addPartner(2, details(), true));
    expectRefused(ed, () => ed.addPartner(5, details({ firstName: '' }), true), /Jméno je povinné/);
    expectRefused(ed, () => ed.addPartner(5, details({ bornDate: '32.01.2000' }), true));
  });

  it('movePartner swaps and renumbers', () => {
    const f = family();
    f.people[0].partners = [{ id: 2, married: true, order: 3 }, { id: 3, married: false, order: 7 }];
    const ed = new FamilyEditor(f);
    ed.movePartner(1, 3, -1);
    expect(ed.person(1).partners.map((r) => [r.id, r.order])).toEqual([[3, 0], [2, 1]]);
    expect(ed.partners(1).map((p) => p.id)).toEqual([3, 2]);
    expectRefused(ed, () => ed.movePartner(1, 3, -1));
    expectRefused(ed, () => ed.movePartner(1, 2, 1));
    expectRefused(ed, () => ed.movePartner(1, 6, 1));
  });

  it('removePartner deletes the partner and renumbers; refused for a named other parent', () => {
    const ed = new FamilyEditor(family());
    expectRefused(ed, () => ed.removePartner(1, 2), /Nelze odebrat: P2 je uveden\(a\) jako rodič dítěte P4/);
    expectRefused(ed, () => ed.removePartner(1, 6));
    ed.addPartner(1, details(), false); // id 7, order 2
    ed.removePartner(1, 3);
    expect(ed.file.people.some((p) => p.id === 3)).toBe(false);
    expect(ed.person(1).partners.map((r) => [r.id, r.order])).toEqual([[2, 0], [7, 1]]);
  });

  it('addChild adds a blood-related child; other parent must be a partner', () => {
    const ed = new FamilyEditor(family());
    const id = ed.addChild(1, details({ sex: 'M' }), 3);
    expect(ed.person(id)).toMatchObject({ id: 7, bloodRelated: true, parentBlood: 1, parentNotBlood: 3, partners: [] });
    const id2 = ed.addChild(5, details(), null);
    expect(ed.person(id2).parentNotBlood).toBeNull();
    expectRefused(ed, () => ed.addChild(1, details(), 6));
    expectRefused(ed, () => ed.addChild(2, details(), null));
    expectRefused(ed, () => ed.addChild(1, details({ firstName: ' ' }), null));
  });

  it('setOtherParent', () => {
    const ed = new FamilyEditor(family());
    ed.setOtherParent(5, 3);
    expect(ed.person(5).parentNotBlood).toBe(3);
    ed.setOtherParent(4, null);
    expect(ed.person(4).parentNotBlood).toBeNull();
    expectRefused(ed, () => ed.setOtherParent(5, 6));
    expectRefused(ed, () => ed.setOtherParent(1, 2));
  });

  it('deletionPreview and deletePerson', () => {
    const ed = new FamilyEditor(family());
    expectRefused(ed, () => ed.deletionPreview(1), /kořenovou/);
    expectRefused(ed, () => ed.deletePerson(1));
    const child = ed.addChild(4, details(), 6);
    expectRefused(ed, () => ed.deletePerson(4), /má děti/);
    expectRefused(ed, () => ed.deletePerson(6), /Nelze odebrat/);
    expect(ed.deletionPreview(child).map((p) => p.id)).toEqual([child]);
    ed.deletePerson(child);
    expect(ed.deletionPreview(4).map((p) => p.id)).toEqual([4, 6]);
    expect(ed.deletePerson(4)).toEqual([4, 6]);
    expect(ed.file.people.map((p) => p.id)).toEqual([1, 2, 3, 5]);
    // Deleting a partner directly removes it from the owner's list.
    ed.setOtherParent(5, null);
    expect(ed.deletePerson(2)).toEqual([2]);
    expect(ed.person(1).partners).toEqual([{ id: 3, married: false, order: 0 }]);
  });

  it('undo restores previous states and tracks dirty against the saved state', () => {
    const ed = new FamilyEditor(family());
    const original = serialize(ed.file);
    expect(ed.dirty).toBe(false);
    expect(ed.canUndo()).toBe(false);
    expect(ed.undo()).toBe(false);

    ed.updatePerson(5, { firstName: 'A' });
    const afterA = serialize(ed.file);
    ed.updatePerson(5, { firstName: 'B' });
    ed.markSaved();
    expect(ed.dirty).toBe(false);

    expect(ed.undo()).toBe(true);
    expect(serialize(ed.file)).toBe(afterA);
    expect(ed.dirty).toBe(true);
    expect(ed.undo()).toBe(true);
    expect(serialize(ed.file)).toBe(original);
    expect(ed.dirty).toBe(true);
    expect(ed.canUndo()).toBe(false);

    ed.updatePerson(5, { firstName: 'C' });
    ed.markSaved();
    ed.updatePerson(5, { firstName: 'D' });
    expect(ed.dirty).toBe(true);
    ed.undo();
    expect(ed.dirty).toBe(false);
  });

  it('batch is one undo step and all-or-nothing', () => {
    const ed = new FamilyEditor(family());
    const before = serialize(ed.file);
    ed.batch(() => {
      ed.updatePerson(3, { firstName: 'X' });
      ed.setMarried(1, 3, true);
    });
    expect(ed.person(3).firstName).toBe('X');
    expect(ed.undo()).toBe(true);
    expect(serialize(ed.file)).toBe(before);
    expect(ed.canUndo()).toBe(false);
    expectRefused(ed, () =>
      ed.batch(() => {
        ed.updatePerson(5, { firstName: 'Y' });
        ed.setOtherParent(5, 6);
      }),
    );
  });

  it('caps the undo stack', () => {
    const ed = new FamilyEditor(family());
    for (let i = 0; i < UNDO_LIMIT + 5; i++) ed.updatePerson(5, { firstName: `N${i}` });
    let n = 0;
    while (ed.undo()) n++;
    expect(n).toBe(UNDO_LIMIT);
    expect(ed.person(5).firstName).toBe('N4');
  });
});
