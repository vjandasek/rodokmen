import { describe, expect, it } from 'vitest';
import { buildTree, type FamilyFile, type Person } from '../src/model.ts';
import { layoutTree } from '../src/layout.ts';
import { resizeLayout } from '../src/resize.ts';
import { rayHalfLength, separation } from '../src/box.ts';
import { boxGap, separateBoxes } from '../src/separate.ts';
import { findOverlaps } from '../src/geometry.ts';

/** Root with three children, who have five, one and four children. */
function family(): FamilyFile {
  const people: Person[] = [];
  let id = 1;
  const add = (parent: number | null) => {
    people.push({
      id, firstName: `Jméno${id}`, lastName: 'Příjmení', maidenName: null, sex: 'F', living: true,
      bloodRelated: true, parentBlood: parent, parentNotBlood: null, partners: [],
    });
    return id++;
  };
  const root = add(null);
  const children = [add(root), add(root), add(root)];
  [5, 1, 4].forEach((n, k) => {
    for (let i = 0; i < n; i++) add(children[k]);
  });
  return { version: 1, rootId: root, people };
}

const layout = layoutTree(buildTree(family()));
/** The layout with the grandchildren's boxes enlarged in place by `scale` (as the lock does). */
const enlarged = (scale: number) => resizeLayout(layout, {
  cellWidth: layout.options.cellWidth, cellHeight: layout.options.cellHeight, levelScale: [2, 1.7, scale],
});

describe('separateBoxes', () => {
  it('leaves a layout without boxes closer than their gap as it is', () => {
    const roomy = enlarged(0.8);
    expect(separateBoxes(roomy)).toBe(roomy);
  });

  for (const scale of [1.8, 2.2, 3]) {
    it(`pushes boxes apart along their rings (grandchildren × ${scale})`, () => {
      const before = enlarged(scale);
      const pairs = findOverlaps(before.nodes).length;
      expect(pairs).toBeGreaterThan(0);
      const after = separateBoxes(before);
      expect(findOverlaps(after.nodes).length).toBeLessThan(pairs);
      after.nodes.forEach((p, i) => {
        const q = before.nodes[i];
        for (const key of ['radius', 'width', 'height', 'stacked', 'arcRadius'] as const) expect(p[key]).toBe(q[key]);
        // At most half the box's own extent along the ring.
        const half = rayHalfLength(q.angle + Math.PI / 2, q.width / 2, q.height / 2) / 2;
        expect(Math.abs(p.angle - q.angle) * q.radius).toBeLessThanOrEqual(half + 1e-6);
        // No pair gets closer than it was, unless it keeps the full gap.
        after.nodes.forEach((o, j) => {
          if (j <= i) return;
          const was = separation(q, before.nodes[j]);
          expect(separation(p, o)).toBeGreaterThanOrEqual(Math.min(was, boxGap(q, before.nodes[j])) - 1e-6);
        });
      });
    });
  }

  it('removes overlaps where there is room, even if the limit stops short of the full gap', () => {
    const before = enlarged(1.8);
    const after = separateBoxes(before);
    expect(findOverlaps(after.nodes)).toEqual([]);
    for (const [a, b] of findOverlaps(before.nodes)) {
      const [i, j] = [before.nodes.indexOf(a), before.nodes.indexOf(b)];
      expect(separation(after.nodes[i], after.nodes[j])).toBeGreaterThan(boxGap(a, b) / 2);
    }
  });
});
