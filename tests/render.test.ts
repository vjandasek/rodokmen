import { describe, expect, it } from 'vitest';
import { buildTree, type FamilyFile, type Person } from '../src/model.ts';
import { layoutTree } from '../src/layout.ts';
import { NAME_SCALE, approximateMeasure, smallestNameSize } from '../src/render.ts';

function person(id: number, firstName: string, parentBlood: number | null): Person {
  return {
    id, firstName, lastName: null, maidenName: null, sex: 'M', living: true, bloodRelated: true,
    parentBlood, parentNotBlood: null, partners: [],
  };
}

/** Root 1 with one child 2, named `name`. */
function layoutWith(name: string) {
  const file: FamilyFile = { version: 2, rootId: 1, people: [person(1, 'A', null), person(2, name, 1)] };
  return layoutTree(buildTree(file));
}

describe('name size', () => {
  it('grows short names by NAME_SCALE over the base fit (the cells keep their size)', () => {
    const layout = layoutWith('B');
    const base = smallestNameSize(layout, approximateMeasure, { nameScale: 1 });
    expect(smallestNameSize(layout, approximateMeasure)).toBeCloseTo(base * NAME_SCALE, 9);
    expect(smallestNameSize(layout, approximateMeasure, { nameScale: 1.2 })).toBeCloseTo(base * 1.2, 9);
  });
  it('a name limited by the cell width does not grow', () => {
    const layout = layoutWith('Bartholomeus-Maximilian');
    const base = smallestNameSize(layout, approximateMeasure, { nameScale: 1 });
    expect(smallestNameSize(layout, approximateMeasure, { nameScale: 1.2 })).toBeCloseTo(base, 9);
  });
});
