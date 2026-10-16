// Branches (branches.ts, widths in connectors.ts): no line through a foreign box, siblings and
// different families never cross, widths within limits; the box colours keep contrast.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTree, type FamilyFile, type Person } from '../src/model.ts';
import { defaultOptions, layoutTree, type Layout } from '../src/layout.ts';
import { resizeLayout } from '../src/resize.ts';
import { DISPLAY_SCALE } from '../src/panel.ts';
import { pathData, polylinesCross, treeBranches, type BranchOptions } from '../src/branches.ts';
import { DEFAULT_MAX_LINE_WIDTH, DEFAULT_MIN_LINE_WIDTH, lineWidths } from '../src/connectors.ts';
import { clearLines } from '../src/clear.ts';
import { separateBoxes } from '../src/separate.ts';
import { connectorParts, findConnectorCrossings } from '../src/geometry.ts';
import { levelColors } from '../src/render.ts';

/** A tree; `childCount(level, k)` for the k-th person created at `level`; every 3rd person has a partner. */
function tree(childCount: (level: number, k: number) => number, maxLevel: number): FamilyFile {
  const people: Person[] = [];
  const created: number[] = [];
  let nextId = 1;
  const grow = (parent: number | null, level: number) => {
    const p: Person = {
      id: nextId++, firstName: `Jméno${nextId}`, lastName: 'Příjmení', maidenName: null, sex: 'M',
      living: true, bloodRelated: true, parentBlood: parent, parentNotBlood: null, partners: [],
    };
    people.push(p);
    if (p.id % 3 === 0) {
      const q: Person = { ...p, id: 10000 + p.id, bloodRelated: false, parentBlood: null, sex: 'F' };
      people.push(q);
      p.partners.push({ id: q.id, married: true, order: 1 });
    }
    const k = created[level] ?? 0;
    created[level] = k + 1;
    if (level >= maxLevel) return;
    const n = childCount(level, k);
    for (let i = 0; i < n; i++) grow(p.id, level + 1);
  };
  grow(null, 0);
  return { version: 1, rootId: 1, people };
}

/** Problems with the branches of a layout, as readable strings (empty = all fine). */
function branchErrors(layout: Layout, options: BranchOptions = {}): string[] {
  const id = (n: { node: { person: { id: number } } }) => n.node.person.id;
  const errors = findConnectorCrossings(layout, options).map(([what, box]) => `${what} crosses ${id(box)}`);
  const min = options.minLineWidth ?? DEFAULT_MIN_LINE_WIDTH;
  const max = options.maxLineWidth ?? DEFAULT_MAX_LINE_WIDTH;
  const parts = connectorParts(layout, options);
  for (const { path } of parts) {
    if (path.width < min - 1e-9 || path.width > max + 1e-9) errors.push(`width ${path.width} out of [${min}, ${max}]`);
  }
  // Siblings: proper crossings only (they share their start in the parent's box).
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].path.parent !== parts[j].path.parent) continue;
      if (polylinesCross(parts[i].points, parts[j].points)) {
        errors.push(`lines to ${id(parts[i].path.child)} and ${id(parts[j].path.child)} cross`);
      }
    }
  }
  return errors;
}

const DATA = new URL('../data/family.json', import.meta.url);
const SHAPES: [(level: number, k: number) => number, number][] = [
  [() => 3, 4],
  [(_, k) => (k % 3 === 0 ? 5 : k % 3 === 1 ? 1 : 0), 5],
  [(l) => (l === 0 ? 2 : 4), 3],
  [(l, k) => (l === 1 && k === 0 ? 9 : 2), 4],
];

describe('branches', () => {
  it('one line per child, box centre to box centre, widths in range, siblings never cross', () => {
    for (const [count, depth] of SHAPES) {
      const layout = layoutTree(buildTree(tree(count, depth)));
      const branches = treeBranches(layout.nodes);
      expect(branches).toHaveLength(layout.nodes.length - 1);
      for (const b of branches) {
        expect(b.child.node.parent).toBe(b.parent.node);
        expect(pathData(b, String)).toBe(`M${b.parent.cx} ${b.parent.cy}L${b.child.cx} ${b.child.cy}`);
      }
      expect(branchErrors(layout).filter((e) => e.startsWith('lines') || e.startsWith('width'))).toEqual([]);
      expect(branchErrors(layout, { minLineWidth: 2, maxLineWidth: 30 }).filter((e) => e.startsWith('width'))).toEqual([]);
      // The measured part starts and ends on the box edges.
      for (const { path, points } of connectorParts(layout)) {
        if (points.length === 0) continue;
        const onEdge = ([x, y]: number[], b: typeof path.parent) =>
          Math.max(Math.abs(x - b.cx) - b.width / 2, Math.abs(y - b.cy) - b.height / 2);
        expect(onEdge(points[0], path.parent)).toBeCloseTo(0, 9);
        expect(onEdge(points[1], path.child)).toBeCloseTo(0, 9);
      }
    }
  });

  // The default display (standard layout, boxes enlarged in place to DISPLAY_SCALE, pushed apart,
  // turned out of lines) has no line behind a foreign box and no crossings on the real data
  // (2026-10-16; the layout alone has one: the line to id 56 behind box 46).
  it.skipIf(!existsSync(DATA))('real data as displayed: no line behind a box, no crossings', () => {
    const root = buildTree(JSON.parse(readFileSync(DATA, 'utf8')) as FamilyFile);
    const display = clearLines(separateBoxes(resizeLayout(layoutTree(root), { ...defaultOptions, levelScale: DISPLAY_SCALE })));
    expect(branchErrors(display)).toEqual([]);
  });

  it('widths grow with the number of people carried, from min to max', () => {
    const layout = layoutTree(buildTree(tree(() => 3, 4)));
    const widths = lineWidths(layout.nodes, 3, 15);
    const leaf = layout.nodes.find((p) => p.node.children.length === 0)!;
    const top = layout.nodes[1];
    expect(widths.get(leaf)).toBe(3);
    expect(widths.get(top)).toBeCloseTo(15);
    expect(widths.get(layout.nodes[2])!).toBeGreaterThan(3);
    expect(widths.get(layout.nodes[2])!).toBeLessThan(15);
  });
});

/** WCAG contrast ratio of two sRGB colours (0..1 channels). */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function hsl(css: string): number[] {
  const [h, s, l] = css.match(/[\d.]+/g)!.map(Number);
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  return [0, 8, 4].map((n) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}

describe('box colours', () => {
  it('white on green and black on grey reach WCAG AA (4.5:1) on every generation', () => {
    for (const maxLevel of [1, 3, 5, 8]) {
      for (let level = 0; level <= maxLevel; level++) {
        const c = levelColors(level, maxLevel);
        expect(contrast(hsl(c.fill), [1, 1, 1])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(hsl(c.deceasedFill), [0x11 / 255, 0x11 / 255, 0x11 / 255])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
