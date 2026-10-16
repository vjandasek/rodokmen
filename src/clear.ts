/**
 * Keeping branches clear of foreign boxes: a line from a parent's box to a child's box
 * should not pass behind a third box. Runs on the drawn layout, after the lock has enlarged the
 * boxes in place (that is how lines end up behind boxes; at the sizes it was computed with the
 * layout keeps them clear).
 *
 * A box a line passes behind (closer than half the line's width plus `LINE_GAP`) turns along its
 * ring on its own: its partners stay in it, its children stay where they are and only the lines
 * to them change direction. It goes to the middle of the free space around it (the angles where
 * it keeps `boxGap` from every box, or at least the distance it already had); if that does not
 * work, as little as clears it; if no angle does, it stays. A move is valid only if no line
 * passes behind the box any more, its own lines pass behind no more boxes than before and cross
 * no more lines of other families than before. Boxes are handled one at a time until none is
 * left that can be helped.
 */
import type { Layout, PlacedNode } from './layout.ts';
import { separation, turned, withBoxes } from './box.ts';
import { boxGap } from './separate.ts';
import { polylineHitsBox, polylinesCross, visiblePoints, type BranchOptions, type Point } from './branches.ts';
import { DEFAULT_MAX_LINE_WIDTH, DEFAULT_MIN_LINE_WIDTH, lineWidths } from './connectors.ts';

/** Gap kept between a line's edge and a box it passes (a moved box keeps `boxGap` from the others). */
export const LINE_GAP = 8;

/** Step of the search for a new angle, as an arc length at the box's ring (scene units). */
const STEP = 1;

/** One straight branch: parent and child index into the node list, its width. */
interface Line {
  from: number;
  to: number;
  width: number;
}

/** The layout with boxes turned away from lines passing behind them (unchanged if none does). */
export function clearLines(layout: Layout, options: BranchOptions = {}): Layout {
  const nodes = layout.nodes.slice();
  const index = new Map(nodes.map((p, i) => [p.node, i]));
  const widths = lineWidths(nodes, options.minLineWidth ?? DEFAULT_MIN_LINE_WIDTH, options.maxLineWidth ?? DEFAULT_MAX_LINE_WIDTH);
  const lines: Line[] = nodes.flatMap((p, i) =>
    p.node.children.map((c) => ({ from: i, to: index.get(c)!, width: widths.get(nodes[index.get(c)!])! })));
  /** Lines starting or ending at each box. */
  const own = nodes.map(() => [] as Line[]);
  for (const l of lines) {
    own[l.from].push(l);
    own[l.to].push(l);
  }

  /** Visible part of each line, dropped when one of its boxes moves. */
  const cache = new Map<Line, Point[]>();
  const points = (l: Line): Point[] => {
    let pts = cache.get(l);
    if (!pts) cache.set(l, (pts = visiblePoints({ parent: nodes[l.from], child: nodes[l.to] })));
    return pts;
  };
  const margin = (l: Line) => l.width / 2 + LINE_GAP;
  /** Whether a line not attached to box i passes behind it. */
  const blocked = (i: number, box: PlacedNode) =>
    lines.some((l) => l.from !== i && l.to !== i && polylineHitsBox(points(l), box, margin(l)));
  /**
   * Foreign boxes behind box i's own lines, and crossings of them with other families' lines,
   * for box i where `nodes[i]` is now (its own lines measured afresh, the others cached).
   */
  const ownTrouble = (i: number) => {
    const fresh = new Map(own[i].map((l) => [l, visiblePoints({ parent: nodes[l.from], child: nodes[l.to] })]));
    let n = 0;
    for (const l of own[i]) {
      const pts = fresh.get(l)!;
      nodes.forEach((box, j) => {
        if (j !== l.from && j !== l.to && polylineHitsBox(pts, box, margin(l))) n++;
      });
      for (const m of lines) {
        if (m.from !== l.from && polylinesCross(pts, fresh.get(m) ?? points(m))) n++;
      }
    }
    return n;
  };

  let moved = false;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i < nodes.length; i++) {
      const original = nodes[i];
      if (!blocked(i, original)) continue;
      const before = ownTrouble(i);
      const spacing = nodes.map((o, j) => (j === i ? Infinity : Math.min(boxGap(original, o), separation(original, o))));
      const fits = (box: PlacedNode) => nodes.every((o, j) => j === i || separation(box, o) >= spacing[j] - 1e-9);
      const works = (box: PlacedNode) => {
        if (blocked(i, box)) return false;
        nodes[i] = box;
        const ok = ownTrouble(i) <= before;
        nodes[i] = original;
        return ok;
      };

      // The free space: from the box's angle both ways as long as it keeps its distances.
      const step = STEP / original.radius;
      const reach = (dir: number) => {
        let k = 0;
        while (k * step < Math.PI && fits(turned(original, original.angle + dir * (k + 1) * step))) k++;
        return k;
      };
      const [left, right] = [reach(-1), reach(1)];
      const middle = turned(original, original.angle + ((right - left) / 2) * step);
      let best: PlacedNode | null = works(middle) ? middle : null;
      for (let k = 1; !best && k <= Math.max(left, right); k++) {
        for (const d of [-k, k]) {
          if (d < -left || d > right) continue;
          const box = turned(original, original.angle + d * step);
          if (works(box)) {
            best = box;
            break;
          }
        }
      }
      if (best) {
        nodes[i] = best;
        for (const l of own[i]) cache.delete(l);
        changed = moved = true;
      }
    }
  }
  return moved ? withBoxes(layout, nodes) : layout;
}
