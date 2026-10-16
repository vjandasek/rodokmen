import type { Layout, PlacedNode } from './layout.ts';
import { polylineHitsBox, polylinesCross, treeBranches, visiblePoints, type BranchOptions } from './branches.ts';

interface Box {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** Axis-aligned overlap; touching edges do not count. */
export function boxesOverlap(a: Box, b: Box, tolerance = 1e-6): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.width + b.width) / 2 - tolerance &&
    Math.abs(a.cy - b.cy) < (a.height + b.height) / 2 - tolerance
  );
}

export function findOverlaps<T extends Box>(boxes: T[]): [T, T][] {
  const result: [T, T][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) result.push([boxes[i], boxes[j]]);
    }
  }
  return result;
}

/** Whether the segment (x1,y1)-(x2,y2) passes through the box interior (Liang–Barsky clipping). */
export function segmentCrossesBox(x1: number, y1: number, x2: number, y2: number, box: Box, tolerance = 1e-6): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const hw = box.width / 2 - tolerance;
  const hh = box.height / 2 - tolerance;
  if (hw <= 0 || hh <= 0) return false;
  let t0 = 0;
  let t1 = 1;
  const clips: [number, number][] = [
    [-dx, x1 - (box.cx - hw)],
    [dx, box.cx + hw - x1],
    [-dy, y1 - (box.cy - hh)],
    [dy, box.cy + hh - y1],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-9;
}

/**
 * Branches that pass through a box other than the two they connect (reported against that box),
 * or that cross a branch of another family (reported against that family's parent).
 */
export function findConnectorCrossings(layout: Layout, options: BranchOptions = {}): [string, PlacedNode][] {
  const parts = connectorParts(layout, options);
  const result: [string, PlacedNode][] = [];
  const name = (p: (typeof parts)[number]) => `line to ${p.path.child.node.person.id}`;
  for (const part of parts) {
    for (const box of layout.nodes) {
      if (box !== part.path.parent && box !== part.path.child && polylineHitsBox(part.points, box, -1e-6)) result.push([name(part), box]);
    }
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].path.parent === parts[j].path.parent) continue;
      if (polylinesCross(parts[i].points, parts[j].points)) result.push([name(parts[j]), parts[i].path.parent]);
    }
  }
  return result;
}

/** Every branch with the visible part of its line (the ends hidden under the boxes neither hit boxes nor cross lines). */
export function connectorParts(layout: Layout, options: BranchOptions = {}) {
  return treeBranches(layout.nodes, options).map((path) => ({ path, points: visiblePoints(path) }));
}
