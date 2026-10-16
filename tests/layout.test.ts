import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTree, walk, type FamilyFile, type Person, type TreeNode } from '../src/model.ts';
import { defaultOptions, layoutTree, type Layout, type LayoutOptions } from '../src/layout.ts';
import { connectorParts, findOverlaps } from '../src/geometry.ts';
import { polylinesCross } from '../src/branches.ts';

/** Pairs of lines of different families that cross (by the children they lead to). */
function familiesCross(layout: Layout): string[] {
  const parts = connectorParts(layout);
  return parts.flatMap((a, i) => parts.slice(i + 1)
    .filter((b) => a.path.parent !== b.path.parent && polylinesCross(a.points, b.points))
    .map((b) => `${a.path.child.node.person.id}×${b.path.child.node.person.id}`));
}

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a FamilyFile from a child-count function, with optional partners. */
function synthetic(
  childCount: (level: number, rnd: () => number) => number,
  maxLevel: number,
  partnerCount: (rnd: () => number) => number,
  seed = 1,
): FamilyFile {
  const rnd = mulberry32(seed);
  const people: Person[] = [];
  let nextId = 1;
  const person = (blood: boolean, parent: number | null): Person => ({
    id: nextId++, firstName: `P${nextId}`, lastName: 'Test', maidenName: null, sex: 'M',
    living: true, bloodRelated: blood, parentBlood: parent, parentNotBlood: null, partners: [],
  });
  const grow = (p: Person, level: number) => {
    const partners = partnerCount(rnd);
    for (let i = 0; i < partners; i++) {
      const partner = person(false, null);
      people.push(partner);
      p.partners.push({ id: partner.id, married: true, order: i });
    }
    if (level >= maxLevel) return;
    const n = childCount(level, rnd);
    for (let i = 0; i < n; i++) {
      const c = person(true, p.id);
      people.push(c);
      grow(c, level + 1);
    }
  };
  const root = person(true, null);
  people.push(root);
  grow(root, 0);
  return { version: 1, rootId: root.id, people };
}

function expectValid(layout: Layout, root: TreeNode) {
  const count = [...walk(root)].length;
  expect(layout.nodes).toHaveLength(count);

  for (const p of layout.nodes) {
    expect(Number.isFinite(p.cx) && Number.isFinite(p.cy) && Number.isFinite(p.angle)).toBe(true);
  }

  const overlaps = findOverlaps(layout.nodes);
  expect(overlaps.map(([a, b]) => `${a.node.person.id}/${b.node.person.id}`)).toEqual([]);
  // Straight lines may pass behind a box (clear.ts turns boxes aside when drawing); lines of
  // different families never cross.
  expect(familiesCross(layout)).toEqual([]);

  const byNode = new Map(layout.nodes.map((p) => [p.node, p]));
  for (const p of layout.nodes) {
    const kids = p.node.children.map((c) => byNode.get(c)!);
    if (kids.length === 0) continue;
    // Siblings keep their order; the packing (no spreading) centres the parent over them.
    for (let i = 1; i < kids.length; i++) expect(kids[i].angle).toBeGreaterThan(kids[i - 1].angle);
    if (p.level > 0 && layout.options.spread === 0) {
      expect(p.angle).toBeCloseTo((kids[0].angle + kids[kids.length - 1].angle) / 2, 9);
    }
  }

  // Every generation keeps its order (pre-order = angular order) and fits into one turn.
  const angles = new Map<number, number[]>();
  for (const p of layout.nodes.slice(1)) angles.set(p.level, [...(angles.get(p.level) ?? []), p.angle]);
  for (const list of angles.values()) {
    for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThan(list[i - 1]);
    expect(Math.max(...list) - Math.min(...list)).toBeLessThan(2 * Math.PI);
  }
}

/** The packing alone (spread 0) and with full centred spreading (spread 1, lean 0, unless `options` say otherwise). */
function bothSpreads(root: TreeNode, options: Partial<LayoutOptions> = {}): Layout[] {
  return [layoutTree(root, { ...options, spread: 0 }), layoutTree(root, { spread: 1, lean: 0, ...options })];
}

/** Smallest free gap (length at the ring radius) between neighbouring boxes of a generation on a full ring. */
function smallestGap(layout: Layout, level: number): number {
  const ring = layout.nodes.filter((p) => p.level === level);
  const cone = (p: Layout['nodes'][number]) => {
    const d = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
      const a = Math.atan2(p.cy + (sy * p.height) / 2, p.cx + (sx * p.width) / 2) - p.angle;
      return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    }));
    return [-Math.min(...d), Math.max(...d)];
  };
  return Math.min(...ring.map((a, k) => {
    const b = ring[(k + 1) % ring.length];
    const wrap = k + 1 === ring.length ? 2 * Math.PI : 0;
    return (b.angle + wrap - cone(b)[0] - a.angle - cone(a)[1]) * a.radius;
  }));
}

const cases: Record<string, FamilyFile> = {
  'single person': synthetic(() => 0, 0, () => 0),
  'one chain': synthetic(() => 1, 8, () => 1),
  'root with many children': synthetic(() => 40, 1, () => 0),
  'wide: 30 x 10 grandchildren': synthetic((l) => (l === 0 ? 30 : 10), 2, () => 0),
  'deep and bushy, 8 generations': synthetic((_, r) => Math.floor(r() * 4), 8, (r) => (r() < 0.5 ? 1 : 0), 7),
  'many partners': synthetic((_, r) => 1 + Math.floor(r() * 3), 4, (r) => Math.floor(r() * 4), 3),
  'unbalanced: one huge branch, many leaves': synthetic(
    (l, r) => (l === 0 ? 12 : r() < 0.15 ? 6 : 0), 6, () => 1, 11,
  ),
};

describe('radial layout', () => {
  for (const [name, file] of Object.entries(cases)) {
    it(name, () => {
      const root = buildTree(file);
      for (const layout of bothSpreads(root)) expectValid(layout, root);
    });
  }

  it('a small tree stays compact', () => {
    const root = buildTree(synthetic(() => 2, 2, () => 0));
    expect(layoutTree(root).extent).toBeLessThan(1000);
  });

  it('a root with two children settles', () => {
    // The root's ring is then just the two children's gaps, which used to trade sizes on every
    // step (children above, then below the horizontal) and never settle.
    let first = 0;
    let sizes = 0;
    const files = [
      ...[1, 2, 3].flatMap((depth) => [0, 1].map((partners) => synthetic((l) => (l === 0 ? 2 : 1), depth, () => partners))),
      // Only the first child has partners.
      synthetic((l) => (l === 0 ? 2 : 1), 2, () => (first++ === 1 ? 2 : 0)),
      // A leaf beside a bushy subtree.
      synthetic((l) => (l === 0 ? 2 : l === 1 ? (sizes++ === 0 ? 0 : 4) : 3), 3, () => 0),
    ];
    for (const file of files) {
      const root = buildTree(file);
      expect(root.children).toHaveLength(2);
      for (const partnerMode of ['auto', 'side'] as const) {
        for (const layout of bothSpreads(root, { partnerMode })) expectValid(layout, root);
      }
    }
  });

  it('spreading moves a crowded family into the free space beside it', () => {
    // Six children of the root; only the first has a grandchild, and that one has six
    // children, packed tightly at generation 3 although the rest of that ring is empty.
    const counts = [[6], [1, 1, 1, 1, 1, 1], [6, 0, 0, 0, 0, 0]];
    const calls = [0, 0, 0];
    const root = buildTree(synthetic((l) => counts[l][calls[l]++] ?? 0, 3, () => 0));
    const [packed, spread] = bothSpreads(root, { lean: 1, maxGap: 1e9 });
    expectValid(packed, root);
    // Spread around the whole ring, a straight line of that family crosses a root line (4×19):
    // only no overlaps are asked of this extreme.
    expect(findOverlaps(spread.nodes)).toEqual([]);
    expect(smallestGap(spread, 3)).toBeGreaterThan(5 * smallestGap(packed, 3));
    expect(spread.radii).toEqual(packed.radii);
    // With the default `maxGap` the siblings, alone on their ring, stop at a comfortable gap.
    const capped = layoutTree(root, { spread: 1, lean: 1 });
    expectValid(capped, root);
    expect(smallestGap(capped, 3)).toBeGreaterThan(smallestGap(packed, 3));
    expect(smallestGap(capped, 3)).toBeLessThanOrEqual(defaultOptions.maxGap + 1e-6);
  });

  it("'auto' makes partners shallow where angle is plentiful", () => {
    // A chain of couples straight up: side by side reaches least there, and the root needs no
    // angle, so it takes the smaller circle (stacked). 'angle' stacks them all instead.
    const root = buildTree(cases['one chain']);
    const auto = layoutTree(root);
    const angle = layoutTree(root, { partnerMode: 'angle' });
    expectValid(auto, root);
    expect(auto.nodes[0].stacked).toBe(true);
    expect(auto.nodes.slice(1).every((p) => !p.stacked)).toBe(true);
    expect(angle.nodes.slice(1).every((p) => p.stacked)).toBe(true);
    expect(auto.extent).toBeLessThan(angle.extent);
  });

});

const realData = new URL('../data/family.json', import.meta.url);
const loadReal = () => buildTree(JSON.parse(readFileSync(realData, 'utf-8')) as FamilyFile);
describe.runIf(existsSync(realData))('real family data', () => {
  it('lays out without overlaps', () => {
    const root = loadReal();
    for (const layout of bothSpreads(root)) expectValid(layout, root);
  });

  it("'auto' never larger than 'angle'", () => {
    const root = loadReal();
    const auto = layoutTree(root, { partnerMode: 'auto', spread: 0 });
    const angle = layoutTree(root, { partnerMode: 'angle', spread: 0 });
    expectValid(auto, root);
    expectValid(angle, root);
    expect(auto.extent).toBeLessThanOrEqual(angle.extent);
  });

  it('forced partner modes', () => {
    const root = loadReal();
    for (const partnerMode of ['side', 'stacked'] as const) {
      for (const layout of bothSpreads(root, { partnerMode })) {
        expectValid(layout, root);
        const partnered = layout.nodes.filter((p) => p.cells > 1);
        expect(partnered.length).toBeGreaterThan(0);
        expect(partnered.every((p) => p.stacked === (partnerMode === 'stacked'))).toBe(true);
      }
    }
  });

  it('spreading: the defaults (spread 0.5, lean 0.5) stay valid', () => {
    const root = loadReal();
    const layout = layoutTree(root);
    expect(layout.options.spread).toBe(0.5);
    expect(layout.options.lean).toBe(0.5);
    expectValid(layout, root);
  });
});
