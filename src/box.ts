/**
 * Geometry of an upright box with half-sizes (a, b) centred at radius r, angle theta (as seen
 * from the root in the centre), and the layout values that follow from where the boxes are.
 */
import type { Bounds, Layout, PlacedNode } from './layout.ts';

const TAU = 2 * Math.PI;

function normalize(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

/** Angular extent [left, right] of the box around its centre direction. */
export function cone(theta: number, r: number, a: number, b: number): [number, number] {
  const cx = r * Math.cos(theta);
  const cy = r * Math.sin(theta);
  let lo = 0;
  let hi = 0;
  for (const [dx, dy] of [[-a, -b], [a, -b], [a, b], [-a, b]]) {
    const d = normalize(Math.atan2(cy + dy, cx + dx) - theta);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [-lo, hi];
}

export function closest(theta: number, r: number, a: number, b: number): number {
  const ax = Math.abs(r * Math.cos(theta));
  const ay = Math.abs(r * Math.sin(theta));
  return Math.hypot(Math.max(ax - a, 0), Math.max(ay - b, 0));
}

export function farthest(theta: number, r: number, a: number, b: number): number {
  return Math.hypot(Math.abs(r * Math.cos(theta)) + a, Math.abs(r * Math.sin(theta)) + b);
}

/** Smallest radius at which the box keeps distance >= D from the centre. */
export function minRadiusFor(theta: number, a: number, b: number, D: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const tol = 1e-9;
  let best = Infinity;
  if (c > 1e-12) {
    const r = (a + D) / c;
    if (r * s <= b + tol) best = Math.min(best, r);
  }
  if (s > 1e-12) {
    const r = (b + D) / s;
    if (r * c <= a + tol) best = Math.min(best, r);
  }
  const p = a * c + b * s;
  const disc = p * p - (a * a + b * b - D * D);
  if (disc >= 0) {
    const r = p + Math.sqrt(disc);
    if (r * c >= a - tol && r * s >= b - tol) best = Math.min(best, r);
  }
  return best;
}

/** Distance from the box centre to its edge along the direction theta. */
export function rayHalfLength(theta: number, a: number, b: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.min(c > 1e-12 ? a / c : Infinity, s > 1e-12 ? b / s : Infinity);
}

export function boundsOf(boxes: PlacedNode[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of boxes) {
    b.minX = Math.min(b.minX, p.cx - p.width / 2);
    b.minY = Math.min(b.minY, p.cy - p.height / 2);
    b.maxX = Math.max(b.maxX, p.cx + p.width / 2);
    b.maxY = Math.max(b.maxY, p.cy + p.height / 2);
  }
  return b;
}

/**
 * The layout with `nodes` (moved or resized boxes, in the same order) in place of its own:
 * ring extremes, extent and bounds follow the boxes; ring radii and everything else stay.
 */
export function withBoxes(layout: Layout, nodes: PlacedNode[]): Layout {
  const { inner: ringInner, outer: ringOuter } = extremes(nodes, layout.ringInner, layout.ringOuter);
  return { ...layout, nodes, ringInner, ringOuter, extent: Math.max(...ringOuter), bounds: boundsOf(nodes) };
}

/** Per generation the nearest box point and farthest box corner; `inner`/`outer` where it has no boxes. */
function extremes(nodes: PlacedNode[], inner: number[], outer: number[]): { inner: number[]; outer: number[] } {
  const near = inner.map(() => Infinity);
  const far = outer.map(() => 0);
  for (const p of nodes) {
    const ax = Math.abs(p.cx);
    const ay = Math.abs(p.cy);
    const a = p.width / 2;
    const b = p.height / 2;
    near[p.level] = Math.min(near[p.level], Math.hypot(Math.max(ax - a, 0), Math.max(ay - b, 0)));
    far[p.level] = Math.max(far[p.level], Math.hypot(ax + a, ay + b));
  }
  return {
    inner: near.map((v, l) => (v === Infinity ? inner[l] : v)),
    outer: far.map((v, l) => (v === 0 ? outer[l] : v)),
  };
}

/** The box turned to `angle` on its ring, with its connector end points as layout.ts sets them. */
export function turned(p: PlacedNode, angle: number): PlacedNode {
  const ray = rayHalfLength(angle, p.width / 2, p.height / 2);
  return {
    ...p, angle, cx: p.radius * Math.cos(angle), cy: p.radius * Math.sin(angle),
    innerRadius: Math.max(0, p.radius - ray), outerRadius: p.radius + ray,
  };
}

/** Gap between two boxes (the larger of the horizontal and vertical one; negative if they overlap). */
export function separation(a: PlacedNode, b: PlacedNode): number {
  return Math.max(
    Math.abs(a.cx - b.cx) - (a.width + b.width) / 2,
    Math.abs(a.cy - b.cy) - (a.height + b.height) / 2,
  );
}
