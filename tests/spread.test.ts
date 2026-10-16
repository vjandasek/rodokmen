// Contract tests for the spreading pass (spread.ts) and its `lean` option: 0 = 'centred' (every
// parent at generation >= 1 stays over the middle of its children), 1 = 'free' (parents may lean),
// in between the angles are interpolated between the two.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTree, walk, type FamilyFile, type Person, type TreeNode } from '../src/model.ts';
import { layoutTree, type Layout, type PlacedNode } from '../src/layout.ts';
import { connectorParts, findOverlaps } from '../src/geometry.ts';
import { polylinesCross } from '../src/branches.ts';

/** Pairs of lines of different families that cross (by the children they lead to). */
function familiesCross(layout: Layout): string[] {
  const parts = connectorParts(layout);
  return parts.flatMap((a, i) => parts.slice(i + 1)
    .filter((b) => a.path.parent !== b.path.parent && polylinesCross(a.points, b.points))
    .map((b) => `${a.path.child.node.person.id}×${b.path.child.node.person.id}`));
}

/** A tree without partners; `childCount(level, k)` for the k-th person created at `level`. */
function tree(childCount: (level: number, k: number) => number, maxLevel: number): FamilyFile {
  const people: Person[] = [];
  const created: number[] = [];
  let nextId = 1;
  const grow = (parent: number | null, level: number) => {
    const p: Person = {
      id: nextId++, firstName: `P${nextId}`, lastName: 'Test', maidenName: null, sex: 'M',
      living: true, bloodRelated: true, parentBlood: parent, parentNotBlood: null, partners: [],
    };
    people.push(p);
    const k = created[level] ?? 0;
    created[level] = k + 1;
    if (level >= maxLevel) return;
    const n = childCount(level, k);
    for (let i = 0; i < n; i++) grow(p.id, level + 1);
  };
  grow(null, 0);
  return { version: 1, rootId: 1, people };
}

/** No box overlaps or connector crossings; sibling and ring order kept; every generation within one turn. */
function expectValid(layout: Layout, root: TreeNode) {
  expect(layout.nodes).toHaveLength([...walk(root)].length);
  for (const p of layout.nodes) {
    expect(Number.isFinite(p.cx) && Number.isFinite(p.cy) && Number.isFinite(p.angle)).toBe(true);
  }
  expect(findOverlaps(layout.nodes).map(([a, b]) => `${a.node.person.id}/${b.node.person.id}`)).toEqual([]);
  // Straight lines may pass behind a box (clear.ts turns boxes aside when drawing); lines of
  // different families never cross.
  expect(familiesCross(layout)).toEqual([]);

  const byNode = new Map(layout.nodes.map((p) => [p.node, p]));
  for (const p of layout.nodes) {
    const kids = p.node.children.map((c) => byNode.get(c)!);
    for (let i = 1; i < kids.length; i++) expect(kids[i].angle).toBeGreaterThan(kids[i - 1].angle);
  }
  const angles = new Map<number, number[]>();
  for (const p of layout.nodes.slice(1)) angles.set(p.level, [...(angles.get(p.level) ?? []), p.angle]);
  for (const list of angles.values()) {
    for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThan(list[i - 1]);
    expect(Math.max(...list) - Math.min(...list)).toBeLessThan(2 * Math.PI);
  }
}

/**
 * Parents at generation >= 1 sit over the middle of their children (unwrapped angles), or exactly
 * over an only child. The root's children are free. Returns the offenders for a readable diff.
 */
function centringErrors(layout: Layout): string[] {
  const byNode = new Map(layout.nodes.map((p) => [p.node, p]));
  const errors: string[] = [];
  for (const p of layout.nodes) {
    if (p.level < 1 || p.node.children.length === 0) continue;
    const kids = p.node.children.map((c) => byNode.get(c)!);
    const middle = (kids[0].angle + kids[kids.length - 1].angle) / 2;
    if (Math.abs(p.angle - middle) >= 1e-6) {
      errors.push(`${p.node.person.id} (gen ${p.level}, ${kids.length} children): off by ${(p.angle - middle).toExponential(2)} rad`);
    }
  }
  return errors;
}

/** Angular extent of a box seen from the centre, relative to its angle: [towards smaller angles, towards larger]. */
function cone(p: PlacedNode): [number, number] {
  const d = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
    const a = Math.atan2(p.cy + (sy * p.height) / 2, p.cx + (sx * p.width) / 2) - p.angle;
    return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  }));
  return [-Math.min(...d), Math.max(...d)];
}

/** Free length at the ring radius between box `a` and the next box `b` of the same generation (`wrap` adds a turn). */
function gapBetween(a: PlacedNode, b: PlacedNode, wrap = 0): number {
  return (b.angle + wrap - cone(b)[0] - a.angle - cone(a)[1]) * a.radius;
}

/** Free gaps between neighbouring boxes of a generation on its full ring (the last one wraps around). */
function ringGaps(layout: Layout, level: number): number[] {
  const ring = layout.nodes.filter((p) => p.level === level);
  return ring.map((a, k) => gapBetween(a, ring[(k + 1) % ring.length], k + 1 === ring.length ? 2 * Math.PI : 0));
}

/** Smallest free gap (length at the ring radius) between neighbouring boxes of a generation on a full ring. */
function smallestGap(layout: Layout, level: number): number {
  return Math.min(...ringGaps(layout, level));
}

/** Number of gaps narrower than `limit` on all rings (generations >= 1). */
function narrowGaps(layout: Layout, limit: number): number {
  const levels = new Set(layout.nodes.filter((p) => p.level >= 1).map((p) => p.level));
  return [...levels].reduce((sum, l) => sum + ringGaps(layout, l).filter((g) => g < limit).length, 0);
}

describe('spreading lean', () => {
  it('lean 0 moves a crowded family into the free space beside it and keeps parents centred', () => {
    // Six children of the root; the first has six children, the other five one each (leaves),
    // so generation 2 is one tightly packed family next to five lone leaves.
    const crowded = buildTree(tree((l, k) => (l === 0 ? 6 : k === 0 ? 6 : 1), 2));
    const packed = layoutTree(crowded, { spread: 0 });
    const centred = layoutTree(crowded, { spread: 1, lean: 0 });
    for (const layout of [packed, centred]) expectValid(layout, crowded);
    expect(centringErrors(centred)).toEqual([]);
    expect(smallestGap(centred, 2)).toBeGreaterThan(smallestGap(packed, 2));
    expect(centred.radii).toEqual(packed.radii);
  });
});

const realData = new URL('../data/family.json', import.meta.url);
const loadReal = () => buildTree(JSON.parse(readFileSync(realData, 'utf-8')) as FamilyFile);
/** A person of the real data by id (ids, not names: no personal data in the repository). */
const byId = (root: TreeNode, id: number) => [...walk(root)].find((n) => n.person.id === id);

describe.runIf(existsSync(realData))('spreading lean on real family data', () => {
  it('defaults (spread 0.5, lean 0.5): valid', () => {
    const root = loadReal();
    const layout = layoutTree(root);
    expect(layout.options.spread).toBe(0.5);
    expect(layout.options.lean).toBe(0.5);
    expectValid(layout, root);
  });

  for (const spread of [1, 0.5]) {
    it(`lean 0, spread ${spread}: valid and centred`, () => {
      const root = loadReal();
      const layout = layoutTree(root, { spread, lean: 0 });
      expectValid(layout, root);
      expect(centringErrors(layout)).toEqual([]);
    });
  }

  it('lean 1, spread 1: valid', () => {
    const root = loadReal();
    expectValid(layoutTree(root, { spread: 1, lean: 1 }), root);
  });

  it('spread 0: lean 0, 0.5 and 1 identical', () => {
    const root = loadReal();
    const [centred, half, free] = [0, 0.5, 1].map((lean) => layoutTree(root, { spread: 0, lean }).nodes.map((p) => [p.angle, p.radius]));
    expect(half).toEqual(centred);
    expect(free).toEqual(centred);
  });
});

describe.runIf(existsSync(realData))('spreading really spreads the real family data (spread 1)', () => {
  it('lean 0: fewer gaps under 10 units than without spreading', () => {
    const root = loadReal();
    const packed = layoutTree(root, { spread: 0 });
    const centred = layoutTree(root, { spread: 1, lean: 0 });
    expect(narrowGaps(centred, 10)).toBeLessThan(narrowGaps(packed, 10));
  });

  it("lean 0: a mother's (id 105) three children move apart and she stays centred over them", (ctx) => {
    const root = loadReal();
    const her = byId(root, 105);
    if (!her || her.children.length !== 3) ctx.skip();
    const packed = layoutTree(root, { spread: 0 });
    const centred = layoutTree(root, { spread: 1, lean: 0 });
    const familyOf = (layout: Layout) => {
      const byNode = new Map(layout.nodes.map((p) => [p.node, p]));
      return { parent: byNode.get(her!)!, kids: her!.children.map((c) => byNode.get(c)!) };
    };
    const before = familyOf(packed);
    const after = familyOf(centred);
    for (let i = 0; i < 2; i++) {
      // At least twice the packed gap: there is plenty of free space on both sides of this family.
      expect(gapBetween(after.kids[i], after.kids[i + 1]), `gap ${i + 1}`).toBeGreaterThan(2 * gapBetween(before.kids[i], before.kids[i + 1]));
    }
    const middle = (after.kids[0].angle + after.kids[2].angle) / 2;
    expect(Math.abs(after.parent.angle - middle)).toBeLessThan(1e-6);
  });

  it('the gap between two ring neighbours of generation 3 (ids 136 and 138) shrinks as lean grows', (ctx) => {
    // The user's screenshot: about 74 units at lean 0, about 28 at lean 1.
    const root = loadReal();
    const left = byId(root, 136);
    const right = byId(root, 138);
    const ring = [...walk(root)].filter((n) => n.level === 3);
    const [i, j] = [left, right].map((n) => (n ? ring.indexOf(n) : -1)).sort((a, b) => a - b);
    if (i < 0 || j - i !== 1) ctx.skip();
    const gaps = [0, 0.5, 1].map((lean) => {
      const placed = layoutTree(root, { spread: 1, lean }).nodes.filter((p) => p.level === 3);
      expect([placed[i].node, placed[j].node]).toEqual([ring[i], ring[j]]);
      return gapBetween(placed[i], placed[j]);
    });
    expect(gaps[1], `lean 0.5 vs 0: ${gaps.map((g) => g.toFixed(1)).join(' / ')}`).toBeLessThan(gaps[0]);
    expect(gaps[2], `lean 1 vs 0.5: ${gaps.map((g) => g.toFixed(1)).join(' / ')}`).toBeLessThan(gaps[1]);
  });
});
