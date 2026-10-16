import { describe, expect, it } from 'vitest';
import { buildTree, type FamilyFile, type Person } from '../src/model.ts';
import { layoutTree, type Layout } from '../src/layout.ts';
import { findOverlapping, resizeLayout } from '../src/resize.ts';

/** Root with a partner, three children (one with a partner), seven grandchildren. */
function family(): FamilyFile {
  const people: Person[] = [];
  const add = (id: number, parent: number | null, blood = true) => {
    const p: Person = {
      id, firstName: `Jméno${id}`, lastName: 'Příjmení', maidenName: null, sex: 'F', living: id % 2 === 0,
      bloodRelated: blood, parentBlood: parent, parentNotBlood: null, partners: [],
    };
    people.push(p);
    return p;
  };
  add(1, null).partners.push({ id: 2, married: true, order: 0 });
  add(2, null, false);
  for (const c of [3, 4, 5]) add(c, 1);
  people.find((p) => p.id === 4)!.partners.push({ id: 6, married: true, order: 0 });
  add(6, null, false);
  for (const [g, parent] of [[7, 3], [8, 3], [9, 4], [10, 4], [11, 4], [12, 5], [13, 5]]) add(g, parent);
  return { version: 1, rootId: 1, people };
}

const tree = buildTree(family());
const sizesOf = (l: Layout) => ({ cellWidth: l.options.cellWidth, cellHeight: l.options.cellHeight, levelScale: l.options.levelScale });

describe('resizeLayout', () => {
  const layout = layoutTree(tree);

  it('keeps centres and angles, scales the boxes, recomputes bounds and extent', () => {
    const s = sizesOf(layout);
    const resized = resizeLayout(layout, { ...s, cellWidth: s.cellWidth * 1.5, cellHeight: s.cellHeight * 1.5 });
    resized.nodes.forEach((p, i) => {
      const q = layout.nodes[i];
      for (const key of ['cx', 'cy', 'angle', 'radius', 'arcRadius', 'stacked', 'cells'] as const) expect(p[key]).toBe(q[key]);
      expect(p.width).toBeCloseTo(q.width * 1.5, 9);
      expect(p.height).toBeCloseTo(q.height * 1.5, 9);
    });
    expect(resized.bounds.minX).toBe(Math.min(...resized.nodes.map((p) => p.cx - p.width / 2)));
    expect(resized.bounds.maxY).toBe(Math.max(...resized.nodes.map((p) => p.cy + p.height / 2)));
    expect(resized.extent).toBeGreaterThan(layout.extent);
    expect(resized.radii).toEqual(layout.radii);
  });

  it('changes only the generation whose scale changed', () => {
    const s = sizesOf(layout);
    const levelScale = s.levelScale.slice();
    levelScale[2] *= 2;
    const resized = resizeLayout(layout, { ...s, levelScale });
    resized.nodes.forEach((p, i) => expect(p.width).toBeCloseTo(layout.nodes[i].width * (p.level === 2 ? 2 : 1), 9));
  });

  it('puts connector end points, ring extremes and extent where layout.ts does', () => {
    // A negligible change takes the recomputing path.
    const s = sizesOf(layout);
    const resized = resizeLayout(layout, { ...s, cellWidth: s.cellWidth * (1 + 1e-12) });
    resized.nodes.forEach((p, i) => {
      expect(p.innerRadius).toBeCloseTo(layout.nodes[i].innerRadius, 6);
      expect(p.outerRadius).toBeCloseTo(layout.nodes[i].outerRadius, 6);
    });
    resized.ringOuter.forEach((r, l) => expect(r).toBeCloseTo(layout.ringOuter[l], 6));
    expect(resized.extent).toBeCloseTo(layout.extent, 6);
    expect(resizeLayout(layout, s)).toBe(layout);
  });
});

describe('findOverlapping', () => {
  const layout = layoutTree(tree);

  it('finds none in a solved layout and a constructed overlap', () => {
    expect(findOverlapping(layout).pairs).toBe(0);
    // Two grandchildren (same size, no partners): put the second onto the first.
    const [a, b] = layout.nodes.filter((p) => p.level === 2);
    const nodes = layout.nodes.map((p) => (p === b ? { ...b, cx: a.cx, cy: a.cy } : p));
    const found = findOverlapping({ ...layout, nodes });
    expect(found.pairs).toBe(1);
    expect(found.boxes.has(a)).toBe(true);
  });

  it('finds overlaps after growing a locked layout', () => {
    const s = sizesOf(layout);
    expect(findOverlapping(resizeLayout(layout, { ...s, cellWidth: s.cellWidth * 3 })).pairs).toBeGreaterThan(0);
  });
});
