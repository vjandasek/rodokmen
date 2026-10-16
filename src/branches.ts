/**
 * Branches between the boxes: one straight line per child, from the centre of the parent's box
 * to the centre of the child's box (root → children too), in whatever direction that is — not
 * radial at either end. Couples: from the centre of the whole box, not of the blood person's
 * cell. The renderer draws branches under the boxes, so both ends hide behind them (round caps);
 * the validity checks measure only the part outside the two boxes (`visiblePoints`). Lines kept
 * clear of foreign boxes: clear.ts.
 */
import type { PlacedNode } from './layout.ts';
import { DEFAULT_MAX_LINE_WIDTH, DEFAULT_MIN_LINE_WIDTH, lineWidths } from './connectors.ts';
import { segmentCrossesBox } from './geometry.ts';

export interface BranchOptions {
  minLineWidth?: number;
  maxLineWidth?: number;
}

export type Point = [number, number];

/** The line from a parent's box to one of its children's. */
export interface Branch {
  parent: PlacedNode;
  child: PlacedNode;
  width: number;
}

/** All branches of the drawing (thickest-first order is up to the renderer). */
export function treeBranches(nodes: PlacedNode[], options: BranchOptions = {}): Branch[] {
  const widths = lineWidths(nodes, options.minLineWidth ?? DEFAULT_MIN_LINE_WIDTH, options.maxLineWidth ?? DEFAULT_MAX_LINE_WIDTH);
  const byNode = new Map(nodes.map((p) => [p.node, p]));
  return nodes.flatMap((parent) => parent.node.children.map((n): Branch => {
    const child = byNode.get(n)!;
    return { parent, child, width: widths.get(child)! };
  }));
}

/**
 * The visible part of a branch: the segment between where it leaves the parent's box and where
 * it enters the child's (empty if the boxes overlap along it).
 */
export function visiblePoints({ parent: a, child: b }: Pick<Branch, 'parent' | 'child'>): Point[] {
  const start: Point = [a.cx, a.cy];
  const end: Point = [b.cx, b.cy];
  const t0 = exitParam(start, end, a);
  const t1 = 1 - exitParam(end, start, b);
  if (t1 <= t0) return [];
  const at = (t: number): Point => [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
  return [at(t0), at(t1)];
}

/** Parameter t ∈ [0, 1] where the segment from `from` (inside `box`) to `to` leaves the box. */
function exitParam(from: Point, to: Point, box: PlacedNode): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let t = 1;
  if (Math.abs(dx) > 1e-15) t = Math.min(t, (box.cx + Math.sign(dx) * box.width / 2 - from[0]) / dx);
  if (Math.abs(dy) > 1e-15) t = Math.min(t, (box.cy + Math.sign(dy) * box.height / 2 - from[1]) / dy);
  return Math.max(0, t);
}

/** SVG path data. */
export function pathData({ parent, child }: Branch, fmt: (n: number) => string): string {
  return `M${fmt(parent.cx)} ${fmt(parent.cy)}L${fmt(child.cx)} ${fmt(child.cy)}`;
}

/** Whether the polyline passes within `margin` of the box. */
export function polylineHitsBox(pts: Point[], box: PlacedNode, margin: number): boolean {
  const grown = { cx: box.cx, cy: box.cy, width: box.width + 2 * margin, height: box.height + 2 * margin };
  const [x0, y0, x1, y1] = bounds(pts);
  if (x1 < box.cx - grown.width / 2 || x0 > box.cx + grown.width / 2 || y1 < box.cy - grown.height / 2 || y0 > box.cy + grown.height / 2) return false;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (segmentCrossesBox(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], grown)) return true;
  }
  return false;
}

/** Bounding box [minX, minY, maxX, maxY] of points. */
function bounds(pts: Point[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Proper crossing of segments ab and cd (touching does not count). */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** Whether two polylines cross properly (bounding boxes first). */
export function polylinesCross(a: Point[], b: Point[]): boolean {
  const [ax0, ay0, ax1, ay1] = bounds(a);
  const [bx0, by0, bx1, by1] = bounds(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
  }
  return false;
}
