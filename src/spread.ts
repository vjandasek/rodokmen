/**
 * Spreading pass (option `spread`), run on the solved layout.
 *
 * The packing (layout.ts) puts every family as tightly as it can under its parent and spreads
 * the angle left over by scaling the whole circle, so clusters stay tight while the same ring
 * is empty right next to them, typically where the neighbours of their ancestors have no
 * descendants that deep. This pass moves boxes sideways into that space. Only angles change:
 * ring radii, connector arc radii, box sizes and partner arrangements stay as solved.
 *
 * Every box gets an angle of its own, all generations at once, so a family may move into a
 * hole together with its parent, or spread out while the parent stays. The free gaps between
 * neighbours on every ring, measured as lengths at the ring's radius, are made as even as the
 * constraints allow: the smallest gap anywhere as large as possible, then the next smallest,
 * and so on (lexicographic max–min by progressive filling, `evenGaps`), but none beyond
 * `maxGap` (or the packing's gap, if wider). The constraints are bounds on the angles and
 * differences between them:
 *  - order and clearance on every ring (`siblingGap` / `cousinGap`, or the packing's gap where
 *    that was less), with the cones at the new angles, also across the seam;
 *  - the connector arcs of neighbouring families on one band (an arc spans the parent's and
 *    the children's angles) stay `cousinGap` apart, or as far as they were if less: a parent
 *    may lean to either side of its children, but not over a neighbouring family;
 *  - every box stays within its generation's band (nearest point and farthest corner as
 *    solved), so rings and arcs stay clear although a box's reach changes with its angle.
 * Cones change with the angle, so the problem is linearised at the latest angles and solved
 * again until they settle. An exact check of the whole layout follows; if it fails, half the
 * move is tried (repeatedly). With `spread` < 1 every angle is interpolated between the
 * packing and the fully spread layout and checked the same way.
 *
 * That is the free target (`lean` 1, `evenOut`). The centred target (`lean` 0, fan.ts) fans
 * every family out about its parent instead, under the same constraints, so every parent
 * (generation ≥ 1) stays exactly over the middle of its first and last child. At either end
 * only that target is computed and `spread` is applied as above (identical to the former
 * 'free' / 'centred' modes). In between both are spread fully and blended per angle:
 * target = centred + lean × (free − centred), final = packed + spread × (target − packed);
 * if the exact check fails, `spread` is reduced in steps of 1/BLEND_STEPS of itself (the lean
 * kept) until it passes.
 */
import type { Layout, PlacedNode } from './layout.ts';
import { closest, cone, farthest, rayHalfLength, withBoxes } from './box.ts';
import { fanOut } from './fan.ts';

const TAU = 2 * Math.PI;
/** Tolerances of the exact check: angles (radians) and distances. */
const EPS = 1e-9;
const EPS_LENGTH = 1e-7;
/** Linearisations at most, and the largest change of an angle (radians) that counts as settled. */
const MAX_ROUNDS = 20;
const SETTLED = 1e-9;
/** Halvings of the move before it is given up. */
const MAX_BACKOFF = 10;
/**
 * Between the targets the move backs off in steps of this fraction: blending two valid layouts
 * fails only where a gap is at its minimum in both (the cones aren't linear in the angle), by
 * second-order amounts, so a small step back usually suffices where halving would lose much.
 */
const BLEND_STEPS = 20;
/** How far (radians) a box may be inside a band boundary as computed. */
const BAND_TOL = 1e-11;
/** Progressive filling: a box that can move less than this is pinned; a gap that can't grow by this is blocked. */
const PIN = 1e-9;
const BUMP = 1e-9;
/** Constraint propagation: smaller changes count as none; a constraint this close to binding is tight. */
const CHANGE = 1e-13;
const TIGHT = 1e-12;
/** Bisection accuracy of a level (relative), where no chain of constraints shows the way. */
const LEVEL_TOL = 1e-12;

/**
 * Things in angular order that keep a smallest gap between neighbours, closing across the
 * seam: the boxes of a ring, or the parents whose connector arcs share a band.
 */
export interface Row {
  /** Node indices in angular order. */
  ids: number[];
  /** Per neighbouring pair (k, k + 1): the smallest gap allowed, as an angle. */
  min: number[];
}

const pairsOf = (row: Row) => (row.ids.length < 2 ? 0 : row.ids.length);
const wrapOf = (row: Row, k: number) => (k + 1 === row.ids.length ? TAU : 0);

export function spreadLayout(layout: Layout): Layout {
  const amount = Math.min(1, layout.options.spread);
  if (!(amount > 0) || layout.nodes.length < 3) return layout;
  const o = layout.options;
  const placed = layout.nodes;
  const N = placed.length;
  const index = new Map(placed.map((p, i) => [p.node, i]));
  const parent = placed.map((p) => (p.node.parent ? index.get(p.node.parent)! : -1));
  const children = placed.map((p) => p.node.children.map((c) => index.get(c)!));
  const radius = placed.map((p) => p.radius);
  const ha = placed.map((p) => p.width / 2);
  const hb = placed.map((p) => p.height / 2);
  const all = Array.from({ length: N - 1 }, (_, k) => k + 1);

  // The band a box stays within: its ring's nearest point and farthest corner as solved.
  const inner = placed.map((p) => layout.ringInner[p.level]);
  const outer = placed.map((p) => layout.ringOuter[p.level]);

  // Rows of boxes (per generation) and of arcs (per generation of the parents).
  const rowMap = new Map<string, Row>();
  const row = (key: string): Row => {
    let r = rowMap.get(key);
    if (!r) rowMap.set(key, (r = { ids: [], min: [] }));
    return r;
  };
  const rings = new Set<Row>();
  const bands = new Set<Row>();
  for (let i = 1; i < N; i++) {
    const l = placed[i].level;
    const ring = row(`r${l}`);
    ring.ids.push(i);
    rings.add(ring);
    if (children[i].length === 0) continue;
    const band = row(`a${l}`);
    band.ids.push(i);
    bands.add(band);
  }

  // Cones at given angles, and the gap of a pair in a row of boxes or of arcs.
  const coneL = new Float64Array(N);
  const coneR = new Float64Array(N);
  const cones = (t: Float64Array) => {
    for (let i = 1; i < N; i++) [coneL[i], coneR[i]] = cone(t[i], radius[i], ha[i], hb[i]);
  };
  const boxGap = (r: Row, k: number, t: Float64Array) => {
    const a = r.ids[k];
    const b = r.ids[(k + 1) % r.ids.length];
    return t[b] + wrapOf(r, k) - coneL[b] - (t[a] + coneR[a]);
  };
  const arcFrom = (i: number, t: Float64Array) => Math.min(t[i], t[children[i][0]]);
  const arcTo = (i: number, t: Float64Array) => Math.max(t[i], t[children[i].at(-1)!]);
  const arcGap = (r: Row, k: number, t: Float64Array) =>
    arcFrom(r.ids[(k + 1) % r.ids.length], t) + wrapOf(r, k) - arcTo(r.ids[k], t);

  // Smallest gaps: the clearance asked for, or what the packing left if that was less.
  const packed = Float64Array.from(placed, (p) => p.angle);
  cones(packed);
  for (const r of rings) {
    for (let k = 0; k < pairsOf(r); k++) {
      const a = r.ids[k];
      const siblings = parent[a] === parent[r.ids[(k + 1) % r.ids.length]];
      r.min[k] = Math.min((siblings ? o.siblingGap : o.cousinGap) / radius[a], boxGap(r, k, packed));
    }
  }
  for (const r of bands) {
    for (let k = 0; k < pairsOf(r); k++) {
      const arc = Math.min(placed[r.ids[k]].arcRadius, placed[r.ids[(k + 1) % r.ids.length]].arcRadius);
      r.min[k] = Math.min(o.cousinGap / arc, arcGap(r, k, packed));
    }
  }

  /** Exact check at angles t: clearances on every row, bands. */
  const valid = (t: Float64Array): boolean => {
    cones(t);
    for (let i = 1; i < N; i++) {
      if (closest(t[i], radius[i], ha[i], hb[i]) < inner[i] - EPS_LENGTH) return false;
      if (farthest(t[i], radius[i], ha[i], hb[i]) > outer[i] + EPS_LENGTH) return false;
    }
    for (const r of rings) for (let k = 0; k < pairsOf(r); k++) if (boxGap(r, k, t) < r.min[k] - EPS) return false;
    for (const r of bands) for (let k = 0; k < pairsOf(r); k++) if (arcGap(r, k, t) < r.min[k] - EPS) return false;
    return true;
  };

  const lean = o.lean >= 1 ? 1 : o.lean > 0 ? o.lean : 0;
  const centred = (f: number) => fanOut({
    parent, children, level: placed.map((p) => p.level), radius, ha, hb, inner, outer,
    rings, bands, packed, valid, maxGap: o.maxGap,
  }, f);
  const result = lean === 0 ? centred(amount) : lean === 1 ? evenOut(amount) : blend(centred(1), evenOut(1));
  if (!result) return layout;

  const nodes = placed.map((p, i): PlacedNode => {
    const angle = result[i];
    if (i === 0 || angle === p.angle) return p;
    const ray = rayHalfLength(angle, ha[i], hb[i]);
    return {
      ...p, angle, cx: p.radius * Math.cos(angle), cy: p.radius * Math.sin(angle),
      innerRadius: Math.max(0, p.radius - ray), outerRadius: p.radius + ray,
    };
  });
  return withBoxes(layout, nodes);

  /**
   * Between the centred and the free target (each spread fully and valid, null: the packing):
   * `lean` of the way from one to the other, `amount` of the way from the packing; while the
   * exact check fails, less of that move, in steps of 1/BLEND_STEPS (null if nothing is valid).
   */
  function blend(c: Float64Array | null, f: Float64Array | null): Float64Array | null {
    if (!c && !f) return null;
    c ??= packed;
    f ??= packed;
    const trial = new Float64Array(N);
    for (let k = 0; k < BLEND_STEPS; k++) {
      const s = amount * (1 - k / BLEND_STEPS);
      for (let i = 0; i < N; i++) trial[i] = packed[i] + s * (c[i] + lean * (f[i] - c[i]) - packed[i]);
      if (valid(trial)) return trial;
    }
    return null;
  }

  /** The free target, the even gaps: `amount` of the way from the packing (null if nothing moves). */
  function evenOut(amount: number): Float64Array | null {
    // The variables: the boxes but the root's, in the order of their angles, so every constraint
    // points forward but those across the seam.
    const order = all.slice().sort((p, q) => packed[p] - packed[q]);
    const v = new Int32Array(N).fill(-1);
    order.forEach((i, k) => (v[i] = k));
    const M = order.length;
    const range = placed.map((_, i) => (i === 0 ? [0, 0] : turnRange(packed[i], radius[i], ha[i], hb[i], inner[i], outer[i])));
    const ringList = [...rings];

    /** The problem linearised with the cones at `trial`; the first one keeps the packing feasible. */
    const problem = (trial: Float64Array, first: boolean): Problem => {
      cones(trial);
      const current = Float64Array.from(order, (i) => packed[i]);
      // Bounds per box.
      const lo = new Float64Array(M).fill(-Infinity);
      const hi = new Float64Array(M).fill(Infinity);
      for (const i of all) {
        lo[v[i]] = packed[i] - range[i][0];
        hi[v[i]] = packed[i] + range[i][1];
        if (first) {
          lo[v[i]] = Math.min(lo[v[i]], trial[i]);
          hi[v[i]] = Math.max(hi[v[i]], trial[i]);
        }
      }
      // Constraints t[b] ≥ t[a] + c between boxes; a gap's constant is its base plus the
      // level-dependent angle (`base` NaN: none).
      const edges: [number, number, number][] = [];
      const edgeGap: number[] = [];
      const edgeBase: number[] = [];
      const link = (a: number, b: number, c: number, gap = -1, base = NaN) => {
        edges.push([v[a], v[b], c]);
        edgeGap.push(gap);
        edgeBase.push(base);
      };
      // The gaps to even out; their constraints get the level of the filling. The gaps of a
      // ring sum up to what the cones leave of the turn (`room`). No gap grows beyond `maxGap`
      // (or what the packing left, if more): a constraint back from b to a.
      const gaps: { scale: number; min: number; ring: number }[] = [];
      const room = new Float64Array(ringList.length);
      ringList.forEach((r, ri) => {
        for (let k = 0; k < pairsOf(r); k++) {
          const a = r.ids[k];
          const b = r.ids[(k + 1) % r.ids.length];
          const base = coneR[a] + coneL[b] - wrapOf(r, k);
          const now = trial[b] - trial[a] - base;
          link(a, b, NaN, gaps.length, base);
          link(b, a, -(base + Math.max(o.maxGap / radius[a], packed[b] - packed[a] - base)));
          gaps.push({ scale: 1 / radius[a], min: first ? Math.min(r.min[k], now) : r.min[k], ring: ri });
          room[ri] -= base;
        }
      });
      // Neighbouring families' arcs: each end of one (parent or last child) before each end of
      // the next (parent or first child).
      for (const r of bands) {
        for (let k = 0; k < pairsOf(r); k++) {
          const p = r.ids[k];
          const q = r.ids[(k + 1) % r.ids.length];
          const c = r.min[k] - wrapOf(r, k);
          for (const a of [p, children[p].at(-1)!]) {
            for (const b of [q, children[q][0]]) link(a, b, first ? Math.min(c, trial[b] - trial[a]) : c);
          }
        }
      }

      // Forward constraints by target (one pass settles them), then those across the seam.
      const seam = (e: number) => edges[e][1] < edges[e][0];
      const sorted = edges.map((_, e) => e);
      sorted.sort((e, f) => Number(seam(e)) - Number(seam(f)) || (seam(e) ? 0 : edges[e][1] - edges[f][1]));
      const rank = new Int32Array(edges.length);
      sorted.forEach((e, r) => (rank[e] = r));
      const forward = sorted.filter((e) => !seam(e)).length;
      const back = Int32Array.from({ length: forward }, (_, r) => r).sort((e, f) => edges[sorted[f]][0] - edges[sorted[e]][0]);
      // Per gap its constraints (positions in `sorted`).
      const gapStart = new Int32Array(gaps.length + 1);
      for (const g of edgeGap) if (g >= 0) gapStart[g + 1]++;
      for (let g = 0; g < gaps.length; g++) gapStart[g + 1] += gapStart[g];
      const gapEdges = new Int32Array(gapStart[gaps.length]);
      const next = gapStart.slice(0, gaps.length);
      edgeGap.forEach((g, e) => {
        if (g >= 0) gapEdges[next[g]++] = rank[e];
      });
      return {
        lo, hi, current,
        from: Int32Array.from(sorted, (e) => edges[e][0]),
        to: Int32Array.from(sorted, (e) => edges[e][1]),
        c: Float64Array.from(sorted, (e) => edges[e][2]),
        forward, back,
        edgeGap: Int32Array.from(sorted, (e) => edgeGap[e]),
        edgeBase: Float64Array.from(sorted, (e) => edgeBase[e]),
        gapStart, gapEdges,
        gapScale: Float64Array.from(gaps, (x) => x.scale),
        gapMin: Float64Array.from(gaps, (x) => x.min),
        gapRing: Int32Array.from(gaps, (x) => x.ring),
        ringRoom: room,
        ringRadius: Float64Array.from(ringList, (r) => radius[r.ids[0]]),
      };
    };

    // Solve, linearised again at the new angles until they settle.
    const spread = packed.slice();
    const next = new Float64Array(N);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const p = evenGaps(problem(spread, round === 0));
      if (!p) break;
      next.set(spread);
      for (const i of order) next[i] = p[v[i]];
      let change = 0;
      for (const i of all) change = Math.max(change, Math.abs(next[i] - spread[i]));
      spread.set(next);
      if (change < SETTLED || (round > 0 && valid(spread))) break;
    }

    // All of the move (`spread` 1) or part of it; less while the exact check fails.
    const trial = new Float64Array(N);
    for (let f = amount, tries = 0; tries <= MAX_BACKOFF; f /= 2, tries++) {
      for (let i = 0; i < N; i++) trial[i] = f === 1 ? spread[i] : packed[i] + f * (spread[i] - packed[i]);
      if (valid(trial)) return trial;
    }
    return null;
  }
}

/**
 * The linearised problem: positions p (angles) with bounds and difference constraints
 * p[to] ≥ p[from] + c, and the gaps to even out. A gap is a constraint whose constant is its
 * `base` (cones, seam) plus the gap's angle; at the level t of the filling (a length) that is
 * max(t · scale, min), scale = 1 / the radius of its ring.
 */
interface Problem {
  lo: Float64Array;
  hi: Float64Array;
  /** The packing's positions: of equally even placements the one nearest to them is taken. */
  current: Float64Array;
  /** Constraints: first the `forward` ones (from < to) by target, then those across the seam. */
  from: Int32Array;
  to: Int32Array;
  c: Float64Array;
  forward: number;
  /** The forward constraints by source, descending (for the rightmost placement). */
  back: Int32Array;
  /** Per constraint: the gap it belongs to (-1: none) and its constant part. */
  edgeGap: Int32Array;
  edgeBase: Float64Array;
  /** Per gap: its constraints (`gapEdges[gapStart[g]..gapStart[g + 1]]`), angle per length, smallest angle and ring. */
  gapStart: Int32Array;
  gapEdges: Int32Array;
  gapScale: Float64Array;
  gapMin: Float64Array;
  gapRing: Int32Array;
  /** Per ring: the most its gaps' angles can sum up to, and its radius. */
  ringRoom: Float64Array;
  ringRadius: Float64Array;
}

/**
 * Lexicographic max–min of the gaps in length units (progressive filling): the largest level
 * all gaps can reach, then the gaps that can't grow beyond it are fixed at their values and
 * the rest go on to the next level. Returns the positions (null if even the smallest gaps
 * are infeasible).
 *
 * The largest level is found from above: where the leftmost placement fails, its chain of
 * tight constraints (a path from a lower to an upper bound, or a cycle around the seam) has a
 * weight linear in the level, which gives the level at which that chain just fits; that is
 * tried next, until a placement succeeds.
 */
function evenGaps(P: Problem): Float64Array | null {
  const n = P.lo.length;
  const E = P.from.length;
  const G = P.gapScale.length;
  const c = P.c.slice();
  const fixed = new Float64Array(G).fill(NaN);
  const gapOf = P.edgeGap;
  const L = new Float64Array(n);
  const R = new Float64Array(n);

  let level = 0;
  const angle = (g: number) => (Number.isNaN(fixed[g]) ? Math.max(level * P.gapScale[g], P.gapMin[g]) : fixed[g]);
  const at = (t: number) => {
    level = t;
    for (let e = 0; e < E; e++) if (gapOf[e] >= 0) c[e] = P.edgeBase[e] + angle(gapOf[e]);
  };
  /** How fast a constraint's constant grows with the level, at the current level. */
  const slope = (e: number) => {
    const g = gapOf[e];
    return g >= 0 && Number.isNaN(fixed[g]) && level * P.gapScale[g] >= P.gapMin[g] ? P.gapScale[g] : 0;
  };

  /** Leftmost placement (into L): -1, or the box where it fails. */
  const place = (): number => {
    L.set(P.lo);
    // A simple path crosses the seam at most once per seam constraint.
    const passes = E - P.forward + 2;
    for (let pass = 0; pass < passes; pass++) {
      for (let e = 0; e < P.forward; e++) {
        const x = L[P.from[e]] + c[e];
        if (x > L[P.to[e]]) L[P.to[e]] = x;
      }
      let changed = -1;
      for (let e = P.forward; e < E; e++) {
        const x = L[P.from[e]] + c[e];
        if (x > L[P.to[e]] + CHANGE) {
          L[P.to[e]] = x;
          changed = P.to[e];
        }
      }
      for (let k = 0; k < n; k++) if (L[k] > P.hi[k] + CHANGE) return k;
      if (changed < 0) return -1;
      if (pass === passes - 1) return changed;
    }
    return -1;
  };

  // Constraints into each box, for walking back from a failed placement.
  const into = new Int32Array(n + 1);
  for (let e = 0; e < E; e++) into[P.to[e] + 1]++;
  for (let k = 0; k < n; k++) into[k + 1] += into[k];
  const intoEdge = new Int32Array(E);
  const filled = into.slice(0, n);
  for (let e = 0; e < E; e++) intoEdge[filled[P.to[e]]++] = e;
  const seen = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n);
  let walk = 0;

  /**
   * The level at which the chain of constraints that pushed box k too far (where placing
   * failed) just fits, or NaN if there is none; the chain goes to `chain`. It is walked back
   * along constraints tight in L to a box at its lower bound (it must fit below k's upper
   * bound), or round a cycle (it must not gain).
   */
  let chain: number[] = [];
  const fits = (k: number): number => {
    walk++;
    const path: number[] = [];
    let j = k;
    let cycle = -1;
    for (;;) {
      seen[j] = walk;
      depth[j] = path.length;
      if (L[j] <= P.lo[j] + TIGHT) break;
      let next = -1;
      cycle = -1;
      for (let r = into[j]; r < into[j + 1]; r++) {
        const e = intoEdge[r];
        if (L[P.from[e]] + c[e] < L[j] - TIGHT) continue;
        if (seen[P.from[e]] !== walk) {
          next = e;
          break;
        }
        cycle = e;
      }
      if (next < 0) break;
      path.push(next);
      j = P.from[next];
    }
    let weight = P.lo[j] - P.hi[k];
    let edges = path;
    if (L[j] > P.lo[j] + TIGHT) {
      if (cycle < 0) return NaN;
      // Round the cycle: from where the closing constraint starts back to j.
      edges = [...path.slice(depth[P.from[cycle]]), cycle];
      weight = 0;
    }
    let growth = 0;
    for (const e of edges) {
      weight += c[e];
      growth += slope(e);
    }
    chain = edges;
    return weight > 0 && growth > 0 ? level - weight / growth : NaN;
  };

  /**
   * The largest feasible level from `low` (feasible) up to `high`, and the chain of
   * constraints that just fits at it (null if the level was bisected or is `high`).
   */
  const raise = (low: number, high: number): [number, number[] | null] => {
    let t = high;
    let limit: number[] | null = null;
    for (let tries = 0; tries < 100 && t > low; tries++) {
      at(t);
      const k = place();
      if (k < 0) break;
      const next = fits(k);
      limit = chain;
      if (next < t - 1e-12 * Math.max(1, Math.abs(t))) {
        t = Math.max(low, next);
        continue;
      }
      // No chain to go by: bisect.
      limit = null;
      while (t - low > LEVEL_TOL * Math.max(1, low)) {
        const mid = (low + t) / 2;
        at(mid);
        if (place() < 0) low = mid;
        else t = mid;
      }
      t = low;
      break;
    }
    return [Math.max(low, t), limit];
  };

  let low = Infinity;
  for (let g = 0; g < G; g++) low = Math.min(low, P.gapMin[g] / P.gapScale[g]);
  at(low);
  if (place() >= 0) return null;
  let active = G;
  const fix = (g: number) => {
    let x = Infinity;
    for (let r = P.gapStart[g]; r < P.gapStart[g + 1]; r++) {
      const e = P.gapEdges[r];
      x = Math.min(x, L[P.to[e]] - L[P.from[e]] - P.edgeBase[e]);
    }
    fixed[g] = x;
    active--;
  };
  const pinned = (g: number) => {
    for (let r = P.gapStart[g]; r < P.gapStart[g + 1]; r++) {
      const e = P.gapEdges[r];
      for (const k of [P.from[e], P.to[e]]) if (R[k] - L[k] > PIN) return false;
    }
    return true;
  };
  while (active > 0) {
    // A ring's active gaps share at most what its other gaps leave.
    const room = P.ringRoom.slice();
    const count = new Int32Array(room.length);
    for (let g = 0; g < G; g++) {
      if (Number.isNaN(fixed[g])) count[P.gapRing[g]]++;
      else room[P.gapRing[g]] -= fixed[g];
    }
    let high = Infinity;
    let fullest = -1;
    room.forEach((r, ring) => {
      if (count[ring] > 0 && (P.ringRadius[ring] * r) / count[ring] < high) {
        high = (P.ringRadius[ring] * r) / count[ring];
        fullest = ring;
      }
    });
    high = Math.max(low, high);
    const [reached, limit] = raise(low, high);
    low = reached;
    at(low);
    place();
    const before = active;
    // The gaps growing on the chain that set the level can't grow any more; if nothing did,
    // the level is what the fullest ring leaves for each of its gaps.
    if (limit) {
      for (const e of limit) if (gapOf[e] >= 0 && slope(e) > 0) fix(gapOf[e]);
    } else if (low === high) {
      for (let g = 0; g < G; g++) if (Number.isNaN(fixed[g]) && P.gapRing[g] === fullest) fix(g);
    }
    // Nor can a gap between two pinned boxes.
    if (rightmost(P, c, R)) {
      for (let g = 0; g < G; g++) if (Number.isNaN(fixed[g]) && pinned(g)) fix(g);
    }
    if (active < before) continue;
    // Nothing pinned (a ring may turn as a whole): fix the gaps that can't grow.
    const blocked: number[] = [];
    for (let g = 0; g < G; g++) {
      if (!Number.isNaN(fixed[g])) continue;
      fixed[g] = angle(g) + BUMP;
      at(low);
      if (place() >= 0) blocked.push(g);
      fixed[g] = NaN;
    }
    at(low);
    place();
    if (blocked.length === 0) for (let g = 0; g < G; g++) if (Number.isNaN(fixed[g])) blocked.push(g);
    blocked.forEach(fix);
  }

  // All gaps fixed: what's left is turning everything together; least overall movement.
  at(low);
  place();
  rightmost(P, c, R);
  let slack = Infinity;
  let mean = 0;
  for (let k = 0; k < n; k++) {
    slack = Math.min(slack, R[k] - L[k]);
    mean += (P.current[k] - L[k]) / n;
  }
  const shift = Math.min(Math.max(mean, 0), Math.max(slack, 0));
  return L.map((x) => x + shift);
}

/** Rightmost positions satisfying every constraint (false if there are none). */
function rightmost(P: Problem, c: Float64Array, R: Float64Array): boolean {
  R.set(P.hi);
  const E = P.from.length;
  for (let pass = 0; pass < E - P.forward + 2; pass++) {
    for (const e of P.back) {
      const x = R[P.to[e]] - c[e];
      if (x < R[P.from[e]]) R[P.from[e]] = x;
    }
    let changed = false;
    for (let e = P.forward; e < E; e++) {
      const x = R[P.to[e]] - c[e];
      if (x < R[P.from[e]] - CHANGE) {
        R[P.from[e]] = x;
        changed = true;
      }
    }
    for (let k = 0; k < R.length; k++) if (R[k] < P.lo[k] - CHANGE) return false;
    if (!changed) return true;
  }
  return false;
}

/**
 * How far a box (half sizes a, b, centre at radius r and angle theta) may turn back and ahead
 * (each at most π) with its nearest point at least `inner` and its farthest corner at most
 * `outer` from the centre. By symmetry it is enough to look at the first quadrant (u = the
 * angle folded into it): the box reaches too far where a·cos u + b·sin u > K, and too near
 * where its centre lies within the box grown by `inner` (with rounded corners), which is
 * three intervals of u. Their images in all four quadrants are the turns to avoid.
 */
function turnRange(theta: number, r: number, a: number, b: number, inner: number, outer: number): [number, number] {
  const R = Math.hypot(a, b);
  const phi = Math.atan2(b, a);
  const bad: [number, number][] = [];
  // Open interval (lo, hi) of u; a bound past an axis (below 0 or above π/2) includes it.
  const add = (lo: number, hi: number) => {
    if (lo < hi) bad.push([lo, hi]);
  };
  // Where cos(u − phi) > x.
  const around = (x: number) => {
    const w = x <= -1 ? Math.PI : Math.acos(x);
    if (x < 1) add(phi - w, phi + w);
  };
  around((outer * outer - r * r - a * a - b * b) / (2 * r * R));
  if (inner > 0) {
    const from = (x: number) => (x >= r ? -1 : Math.acos(x / r));
    const until = (x: number) => (x >= r ? Math.PI : Math.asin(x / r));
    add(from(a + inner), until(b));
    add(from(a), until(b + inner));
    around((r * r + R * R - inner * inner) / (2 * r * R));
  }
  const mod = (x: number) => x - TAU * Math.floor(x / TAU);
  let back = Math.PI;
  let ahead = Math.PI;
  for (const [s, e] of bad) {
    const lo = Math.max(s, -BAND_TOL) + BAND_TOL;
    const hi = Math.min(e, Math.PI / 2 + BAND_TOL) - BAND_TOL;
    for (const [A, B] of [[lo, hi], [Math.PI - hi, Math.PI - lo], [Math.PI + lo, Math.PI + hi], [TAU - hi, TAU - lo]]) {
      if (!(A < B)) continue;
      const into = mod(theta - A);
      if (into > 0 && into < B - A) return [0, 0];
      ahead = Math.min(ahead, mod(A - theta));
      back = Math.min(back, mod(theta - B));
    }
  }
  return [back, ahead];
}
