/**
 * New box sizes for a locked layout ("Zamknout rozmístění"): every box keeps its centre,
 * angle, partner arrangement and connector arc and is only redrawn with the new cell size,
 * so sizes can be tuned without a relayout. Boxes may then overlap (`findOverlapping`).
 */
import type { Layout, LayoutOptions, PlacedNode } from './layout.ts';
import { rayHalfLength, withBoxes } from './box.ts';
import { findOverlaps } from './geometry.ts';

export type Sizes = Pick<LayoutOptions, 'cellWidth' | 'cellHeight' | 'levelScale'>;

/** The locked layout with cells of `sizes`. Unchanged sizes return the locked layout itself. */
export function resizeLayout(locked: Layout, sizes: Sizes): Layout {
  const o = locked.options;
  const scaleAt = (s: number[], l: number) => s[Math.min(l, s.length - 1)];
  const sameScales = locked.scales.every((_, l) => scaleAt(o.levelScale, l) === scaleAt(sizes.levelScale, l));
  if (sizes.cellWidth === o.cellWidth && sizes.cellHeight === o.cellHeight && sameScales) return locked;

  const scales = locked.scales.map((_, l) => scaleAt(sizes.levelScale, l));
  const nodes = locked.nodes.map((p): PlacedNode => {
    const cellWidth = sizes.cellWidth * scales[p.level];
    const cellHeight = sizes.cellHeight * scales[p.level];
    const width = p.stacked ? cellWidth : p.cells * cellWidth;
    const height = p.stacked ? p.cells * cellHeight : cellHeight;
    // Connector end points as layout.ts sets them: the root's circumscribed circle, else
    // where the ray from the centre enters and leaves the box.
    const ray = p.level === 0 ? Math.hypot(width / 2, height / 2) : rayHalfLength(p.angle, width / 2, height / 2);
    return {
      ...p, cellWidth, cellHeight, width, height,
      innerRadius: Math.max(0, p.radius - ray), outerRadius: p.radius + ray,
    };
  });

  // Ring extremes describe the boxes, so they follow them; the ring radii stay.
  return {
    ...withBoxes(locked, nodes),
    scales,
    options: { ...o, cellWidth: sizes.cellWidth, cellHeight: sizes.cellHeight, levelScale: sizes.levelScale.slice() },
  };
}

/** Overlapping box pairs and every box involved in one. */
export function findOverlapping(layout: Layout): { pairs: number; boxes: Set<PlacedNode> } {
  const pairs = findOverlaps(layout.nodes);
  return { pairs: pairs.length, boxes: new Set(pairs.flat()) };
}
