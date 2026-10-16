import { describe, expect, it } from 'vitest';
import { buildTree, type FamilyFile, type Person } from '../src/model.ts';
import { layoutTree, type Layout } from '../src/layout.ts';
import { turned, withBoxes } from '../src/box.ts';
import { clearLines } from '../src/clear.ts';
import { findConnectorCrossings, findOverlaps } from '../src/geometry.ts';

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

/**
 * The layout with one grandchild turned (in steps of 0.5°, nearest first) to where a line of
 * another family passes behind it without it overlapping a box.
 */
function withBlockedBox(): { blocked: Layout; index: number } {
  const overlaps = findOverlaps(layout.nodes).length;
  for (let d = 0.5; d <= 30; d += 0.5) {
    for (const [index, p] of layout.nodes.entries()) {
      if (p.level !== 2) continue;
      for (const sign of [-1, 1]) {
        const nodes = layout.nodes.slice();
        nodes[index] = turned(p, p.angle + (sign * d * Math.PI) / 180);
        const blocked = withBoxes(layout, nodes);
        const behind = findConnectorCrossings(blocked).some(([, box]) => box === nodes[index]);
        if (behind && findOverlaps(nodes).length === overlaps) return { blocked, index };
      }
    }
  }
  throw new Error('no position behind a line found');
}

describe('clearLines', () => {
  it('leaves a layout without lines behind boxes as it is', () => {
    expect(findConnectorCrossings(layout)).toEqual([]);
    expect(clearLines(layout)).toBe(layout);
  });

  it('turns a box a line passes behind out of the way, nothing else', () => {
    const { blocked, index } = withBlockedBox();
    const cleared = clearLines(blocked);
    expect(findConnectorCrossings(cleared)).toEqual([]);
    expect(findOverlaps(cleared.nodes).length).toBe(findOverlaps(blocked.nodes).length);
    cleared.nodes.forEach((p, i) => {
      if (i !== index) expect(p).toBe(blocked.nodes[i]);
      for (const key of ['radius', 'width', 'height', 'stacked', 'arcRadius'] as const) expect(p[key]).toBe(blocked.nodes[i][key]);
    });
    expect(cleared.nodes[index].angle).not.toBe(blocked.nodes[index].angle);
    expect(cleared.radii).toEqual(blocked.radii);
  });
});
