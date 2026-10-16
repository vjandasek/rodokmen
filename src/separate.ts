/**
 * Pushing boxes apart that are too close: runs on the drawn layout (after the lock has enlarged
 * the boxes in place, which is how boxes come to overlap or almost touch) and before `clearLines`.
 *
 * Every pair of neighbouring boxes on a ring closer than its gap (`boxGap`: `SIBLING_GAP`
 * between siblings, `FAMILY_GAP` otherwise, so families stay visibly apart; boxes of different
 * rings `SIBLING_GAP`) slides apart along
 * the ring until it has it; boxes they push keep at least their gap (or what they had, if less),
 * so the push passes on along the ring as far as needed. Only boxes move (their partners stay in
 * them, their children stay where they are and only the lines to them change direction), and no
 * box moves more than half its own width along the ring (`LIMIT`). Where there is not enough
 * room the boxes spread as far as that allows, so a gap (or an overlap) may only shrink.
 *
 * Solved exactly per ring, in angles: the ring is cut at the roomiest gap into a chain; each pair
 * needs an angular distance (found by bisection for its gap); a pair that is too close gets
 * `lambda` of the way from where it was to its gap. The largest `lambda` all of them can reach
 * within the limits is found (bisection, feasibility by a greedy sweep), the stretch that stops
 * it keeps it, and the rest aim higher again (max–min), so one crowded spot does not hold back
 * the others. Positions are then found by pushing pairs apart (half and half, within the limits)
 * from where the boxes were, and the angular distances are recomputed there once more. Boxes on
 * other rings (where the rings solved before left them) narrow each box's limits: it moves only
 * as far as it keeps its gap (or what it had) from them. Boxes of different rings still closer than their gap
 * then take turns: one of the two turns away along its ring (the smallest move that reaches the
 * gap, else the one that gets furthest), keeping every other gap it has. Pairs further apart on
 * a ring are only checked: if one got closer than it was (and than its gap), the moves on its rings are scaled
 * back.
 */
import type { Layout, PlacedNode } from './layout.ts';
import { rayHalfLength, separation, turned, withBoxes } from './box.ts';

/** Gap aimed for between siblings (the same as between lines and boxes). */
export const SIBLING_GAP = 8;
/** Gap aimed for between other boxes, so neighbouring families stay apart. */
export const FAMILY_GAP = 12;

/**
 * The gap two boxes should keep: on one ring siblings `SIBLING_GAP` and others `FAMILY_GAP`;
 * boxes of different rings (one beyond the other, e.g. a parent and its child) `SIBLING_GAP`.
 */
export function boxGap(a: PlacedNode, b: PlacedNode): number {
  if (a.level !== b.level) return SIBLING_GAP;
  return a.node.parent && a.node.parent === b.node.parent ? SIBLING_GAP : FAMILY_GAP;
}

/** Furthest a box may move along its ring, as a share of its own width along the ring. */
const LIMIT = 0.5;

/** Rounds of solving a ring with the angular distances measured where the boxes ended up. */
const ROUNDS = 3;
const MAX_SWEEPS = 5000;
/** Tolerance (scene units) of the final check that no pair got closer than it was. */
const TOLERANCE = 0.01;
/** Aimed above every gap, so the angle approximations still end at or above it. */
const MARGIN = 0.05;
/** Step of the search for how far a box may move before it nears a box of another ring (scene units). */
const STEP = 0.5;

/** The layout with boxes pushed apart to their gaps (unchanged if none is too close). */
export function separateBoxes(layout: Layout): Layout {
  const start = layout.nodes;
  const nodes = start.slice();
  const limit = start.map((p) => (p.level === 0 ? 0 : (LIMIT * rayHalfLength(p.angle + Math.PI / 2, p.width / 2, p.height / 2)) / p.radius));
  const reach = start.map((p, i) => Math.hypot(p.width, p.height) / 2 + limit[i] * p.radius);
  // Pairs that could come closer than their gap within the limits, with the separation they keep.
  const pairs: [number, number, number][] = [];
  const near = start.map(() => [] as [number, number][]);
  const all = start.map(() => [] as [number, number][]);
  for (let a = 0; a < start.length; a++) {
    for (let b = a + 1; b < start.length; b++) {
      const [p, q] = [start[a], start[b]];
      if (Math.hypot(p.cx - q.cx, p.cy - q.cy) > reach[a] + reach[b] + FAMILY_GAP) continue;
      const keep = Math.min(separation(p, q), boxGap(p, q));
      pairs.push([a, b, keep - TOLERANCE]);
      all[a].push([b, keep - TOLERANCE]);
      all[b].push([a, keep - TOLERANCE]);
      if (p.level !== q.level) {
        near[a].push([b, keep]);
        near[b].push([a, keep]);
      }
    }
  }
  const rings = new Map<number, number[]>();
  start.forEach((p, i) => {
    if (p.level > 0) rings.set(p.level, [...(rings.get(p.level) ?? []), i]);
  });
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  for (const ring of rings.values()) {
    ring.sort((i, j) => norm(start[i].angle) - norm(start[j].angle));
    // How far each box may turn either way before it nears a box of another ring.
    const room = (i: number, dir: number) => {
      const step = STEP / start[i].radius;
      let k = 0;
      while ((k + 1) * step <= limit[i]) {
        const box = turned(start[i], start[i].angle + dir * (k + 1) * step);
        if (near[i].some(([j, keep]) => separation(box, nodes[j]) < keep)) break;
        k++;
      }
      return near[i].length === 0 ? limit[i] : k * step;
    };
    solveRing(nodes, start, ring, ring.map((i) => room(i, -1)), ring.map((i) => room(i, 1)));
  }
  pushAcross(nodes, start, pairs, all, limit);
  if (nodes.every((p, i) => p === start[i])) return layout;

  // Any pair that got closer than it was and than its gap: scale back its rings' moves.
  const worse = (boxes: PlacedNode[]) => pairs.filter(([a, b, need]) => separation(boxes[a], boxes[b]) < need);
  for (let bad = worse(nodes); bad.length > 0; bad = worse(nodes)) {
    const levels = new Set(bad.flatMap(([a, b]) => [start[a].level, start[b].level]));
    const members = start.map((_, i) => i).filter((i) => levels.has(start[i].level) && nodes[i] !== start[i]);
    const moved = members.map((i) => nodes[i]);
    const at = (t: number) => {
      members.forEach((i, k) => {
        nodes[i] = t === 1 ? moved[k] : t === 0 ? start[i] : turned(start[i], start[i].angle + t * (moved[k].angle - start[i].angle));
      });
    };
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 30; k++) {
      const t = (lo + hi) / 2;
      at(t);
      if (worse(nodes).some(([a, b]) => levels.has(start[a].level) || levels.has(start[b].level))) hi = t;
      else lo = t;
    }
    at(lo);
    if (lo === 0) break;
  }
  return nodes.some((p, i) => p !== start[i]) ? withBoxes(layout, nodes) : layout;
}

/** Pairs of boxes of different rings still closer than their gap: one of the two turns away. */
function pushAcross(nodes: PlacedNode[], start: PlacedNode[], pairs: [number, number, number][], all: [number, number][][], limit: number[]) {
  const across = pairs.filter(([a, b]) => start[a].level !== start[b].level);
  for (let round = 0, changed = true; changed && round < 3; round++) {
    changed = false;
    for (const [a, b] of across) {
      const gap = boxGap(start[a], start[b]);
      let best = { sep: separation(nodes[a], nodes[b]), move: 0, i: -1, box: nodes[a] };
      if (best.sep >= gap - TOLERANCE) continue;
      for (const [i, other] of [[a, b], [b, a]]) {
        if (start[i].level === 0) continue;
        const step = STEP / start[i].radius;
        for (const dir of [-1, 1]) {
          for (let k = 1; ; k++) {
            const angle = nodes[i].angle + dir * k * step;
            if (Math.abs(angle - start[i].angle) > limit[i]) break;
            const box = turned(start[i], angle);
            if (all[i].some(([j, keep]) => j !== other && separation(box, nodes[j]) < keep)) break;
            const sep = separation(box, nodes[other]);
            const move = k * step;
            const reached = sep >= gap;
            const bestReached = best.sep >= gap;
            if (reached ? !bestReached || move < best.move : !bestReached && sep > best.sep + 1e-9) best = { sep, move, i, box };
            if (reached) break;
          }
        }
      }
      if (best.i >= 0) {
        nodes[best.i] = best.box;
        changed = true;
      }
    }
  }
}

/**
 * Neighbouring boxes of one ring (`ring` sorted by angle), `nodes[ring[k]]` and
 * `nodes[ring[k + 1]]`, pushed apart; box `ring[k]` may turn `down[k]` back and `up[k]` on.
 */
function solveRing(nodes: PlacedNode[], start: PlacedNode[], ring: number[], down: number[], up: number[]) {
  const m = ring.length;
  if (m < 2) return;
  const turn = 2 * Math.PI;
  const norm = (a: number) => ((a % turn) + turn) % turn;
  // Pair k: ring[k] and the next box counterclockwise (angle increasing), around the seam.
  const next = (k: number) => ring[(k + 1) % m];
  const diff0 = ring.map((i, k) => norm(start[next(k)].angle - start[i].angle) || turn);
  const gap = ring.map((i, k) => boxGap(start[i], start[next(k)]) + MARGIN);
  const tooClose = ring.map((i, k) => separation(start[i], start[next(k)]) < gap[k]);
  if (!tooClose.some(Boolean)) return;

  let need = ring.map((i, k) => angleFor(start[i], start[next(k)], start[i].angle, diff0[k], gap[k]));
  // The chain starts after the roomiest pair (its gap is not a constraint).
  let cut = 0;
  for (let k = 1; k < m; k++) if (diff0[k] - need[k] > diff0[cut] - need[cut]) cut = k;
  const order = Array.from({ length: m }, (_, j) => (cut + 1 + j) % m); // chain position → ring index
  const pairOf = (j: number) => order[j]; // chain pair j: chain boxes j, j + 1 = ring pair order[j]
  const t0: number[] = [0];
  for (let j = 1; j < m; j++) t0.push(t0[j - 1] + diff0[pairOf(j - 1)]);
  const base = start[ring[order[0]]].angle;
  const lo = order.map((k, j) => t0[j] - down[k]);
  const hi = order.map((k, j) => t0[j] + up[k]);

  let x = t0.slice();
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) {
      need = ring.map((i, k) => {
        const [jp, jq] = [order.indexOf(k), order.indexOf((k + 1) % m)];
        return jq === jp + 1 ? angleFor(start[i], start[next(k)], base + x[jp], x[jq] - x[jp], gap[k]) : need[k];
      });
    }
    // Angular distance chain pair j needs with target lambda (the pair's own, once fixed).
    const fixed: (number | undefined)[] = new Array(m - 1).fill(undefined);
    const distance = (j: number, lambda: number) => {
      const k = pairOf(j);
      if (!tooClose[k]) return need[k];
      const l = fixed[j] ?? lambda;
      return diff0[k] + l * (need[k] - diff0[k]);
    };
    /** Leftmost positions; the first chain box that can't stay within its limit, or -1. */
    const sweep = (lambda: number): [number[], number] => {
      const left = [lo[0]];
      for (let j = 1; j < m; j++) {
        left.push(Math.max(lo[j], left[j - 1] + distance(j - 1, lambda)));
        if (left[j] > hi[j] + 1e-12) return [left, j];
      }
      return [left, -1];
    };
    for (;;) {
      const open = [...fixed.keys()].filter((j) => tooClose[pairOf(j)] && fixed[j] === undefined);
      if (open.length === 0) break;
      if (sweep(1)[1] < 0) {
        for (const j of open) fixed[j] = 1;
        break;
      }
      let [a, b] = [0, 1];
      for (let it = 0; it < 40; it++) {
        const mid = (a + b) / 2;
        if (sweep(mid)[1] < 0) a = mid;
        else b = mid;
      }
      // The stretch that fails just above `a`: from the last box resting at its lower limit.
      const [left, fail] = sweep(b);
      let first = fail;
      while (first > 0 && left[first] > lo[first] + 1e-12) first--;
      const stuck = open.filter((j) => j >= first && j < fail);
      for (const j of stuck.length > 0 ? stuck : open) fixed[j] = a;
    }
    x = place(t0, lo, hi, (j) => distance(j, 1));
  }
  order.forEach((k, j) => {
    const i = ring[k];
    // Relative to its own angle, so angles stay unwrapped as layout.ts left them.
    if (Math.abs(x[j] - t0[j]) > 1e-12) nodes[i] = turned(start[i], start[i].angle + x[j] - t0[j]);
  });
}

/** Chain positions from `t0`, every pair pushed apart (half and half, within the limits) to its distance. */
function place(t0: number[], lo: number[], hi: number[], distance: (j: number) => number): number[] {
  const x = t0.slice();
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let moved = 0;
    for (let j = 0; j + 1 < x.length; j++) {
      const short = distance(j) - (x[j + 1] - x[j]);
      if (short <= 1e-13) continue;
      const roomA = x[j] - lo[j];
      const roomB = hi[j + 1] - x[j + 1];
      let a = Math.min(roomA, short / 2);
      const b = Math.min(roomB, short - a);
      a = Math.min(roomA, short - b);
      x[j] -= a;
      x[j + 1] += b;
      moved += a + b;
    }
    if (moved < 1e-13) break;
  }
  return x;
}

/**
 * Angular distance at which boxes `p` (at `from`) and `q` (`diff` further on) are `gap` apart,
 * both turned symmetrically about their middle.
 */
function angleFor(p: PlacedNode, q: PlacedNode, from: number, diff: number, gap: number): number {
  const mid = from + diff / 2;
  const apart = (d: number) => separation(turned(p, mid - d / 2), turned(q, mid + d / 2));
  let [a, b] = [0, Math.max(diff, 1e-6)];
  while (apart(b) < gap && b < Math.PI) [a, b] = [b, 2 * b];
  if (apart(b) < gap) return b;
  for (let it = 0; it < 50; it++) {
    const m = (a + b) / 2;
    if (apart(m) >= gap) b = m;
    else a = m;
  }
  return b;
}
