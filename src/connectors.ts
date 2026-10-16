/** Branch line widths (branches.ts): by the number of people a branch carries. */
import type { PlacedNode } from './layout.ts';

/** Default line widths of the branches (scene units): lines to single people, the thickest root line. */
export const DEFAULT_MIN_LINE_WIDTH = 6.5;
export const DEFAULT_MAX_LINE_WIDTH = 40;

/**
 * Line width of the branch into each node (the branch carries the node's subtree): ∝ √size
 * between `min` (one person) and `max` (the biggest subtree hanging off the root).
 */
export function lineWidths(
  nodes: PlacedNode[], min = DEFAULT_MIN_LINE_WIDTH, max = DEFAULT_MAX_LINE_WIDTH,
): Map<PlacedNode, number> {
  const sizes = subtreeSizes(nodes);
  const byNode = new Map(nodes.map((p) => [p.node, p]));
  const biggest = Math.max(1, ...nodes[0].node.children.map((c) => sizes.get(byNode.get(c)!)!));
  const top = Math.max(min, max);
  const widths = new Map<PlacedNode, number>();
  for (const [p, n] of sizes) {
    const t = biggest > 1 ? (Math.sqrt(n) - 1) / (Math.sqrt(biggest) - 1) : 0;
    widths.set(p, Math.min(top, min + (top - min) * Math.max(0, t)));
  }
  return widths;
}

/** Number of people in each node's subtree (the node and its descendants, without partners). */
export function subtreeSizes(nodes: PlacedNode[]): Map<PlacedNode, number> {
  const byNode = new Map(nodes.map((p) => [p.node, p]));
  const sizes = new Map<PlacedNode, number>();
  // Pre-order: children come after their parent, so walk backwards.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const p = nodes[i];
    sizes.set(p, 1 + p.node.children.reduce((s, c) => s + sizes.get(byNode.get(c)!)!, 0));
  }
  return sizes;
}
