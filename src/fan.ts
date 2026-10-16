/**
 * The centred target of the spreading pass (`lean` 0; spread.ts blends it with the free
 * target for 0 < `lean` < 1): families fan out and their middle children slide, while every
 * parent at generation ≥ 1 stays exactly over the middle of its first and last child.
 *
 * The packing (layout.ts) puts every parent exactly over the middle of its first and last
 * child (an only child straight below it). Here every family whose parent is at generation ≥ 1
 * and has at least two children gets one variable, its fan factor s ≥ 1: a child's angle is
 * its parent's angle plus s × its packed offset from the parent, and the child's subtree turns
 * with it (plus its own family's fan). The parent therefore stays exactly in the middle, an
 * only child keeps its offset 0 (stays in line), and the root's children stay as packed (their
 * family already uses the whole circle; fanning it would be the packing's own uniform scaling).
 *
 * Middle children slide: centring fixes only a family's first and last child, so the children
 * in between (families with ≥ 3 children) may move between their neighbouring siblings, each
 * with its whole subtree rigidly (plus its own family's fan): its angle is its parent's angle
 * + s × its packed offset + its slide. A middle child moves towards the middle of its free
 * interval: the slide that makes the smallest free gap (length at the ring radius) between its
 * subtree and the boxes beside it on the left as large as the smallest one on the right, over
 * all rings its subtree reaches, within the slack of the ring clearances and connector arcs
 * (linearised).
 *
 * Growth: all families take turns (round-robin, in pre-order) and each turn tries to widen its
 * family by `STEP` length units at its children's ring; a step is kept only if valid, otherwise
 * the family's step is halved, below `MIN_STEP` the family stops. After every round of turns,
 * every middle child whose surroundings moved slides (halved while invalid), so space freed by
 * one family is shared with its neighbours. As a family can be unblocked when others move, the
 * sweeps are repeated (at most `MAX_SWEEPS`) until one gains nothing.
 *
 * Validity is that of the free target (spread.ts), checked locally for the boxes and arcs a
 * step moves (a subtree is contiguous in pre-order and on every ring): ring order and clearance
 * with the exact cones at the new angles, also across the seam; the connector arcs of
 * neighbouring families on one band; every box within its generation's band. On top of that, max–min (even out, don't
 * push): a gap that a step narrows must stay at least the smallest gap of its ring. The exact
 * whole-layout check follows at the end. With `amount` < 1 every factor is interpolated,
 * s = 1 + amount × (s − 1), and every slide scaled by `amount`; while the exact check fails,
 * half of it is tried (repeatedly).
 */
import type { Row } from './spread.ts';
import { closest, cone, farthest } from './box.ts';

const TAU = 2 * Math.PI;
/** Tolerances of the checks (as in spread.ts): angles (radians) and distances. */
const EPS = 1e-9;
const EPS_LENGTH = 1e-7;
/** How much a family widens per turn, and the smallest step tried (length units at its children's ring). */
const STEP = 4;
const MIN_STEP = 0.25;
/** Repeated sweeps of turns, for families unblocked by others' growth. */
const MAX_SWEEPS = 6;
/** Halvings of the fanning before it is given up. */
const MAX_BACKOFF = 10;
/** Slides shorter than this (length units at the child's ring) are skipped; halvings of a slide tried. */
const MIN_SLIDE = 0.05;
const SLIDE_HALVINGS = 4;
/** Rounds of slides per sweep once growth has stopped (growth stops by itself). */
const MAX_ROUNDS = 60;
/** Bisection steps of a slide's target. */
const BISECT = 50;

/** What spread.ts has worked out about the layout; node indices in pre-order (0 = the root). */
export interface Spreading {
  parent: number[];
  children: number[][];
  level: number[];
  radius: number[];
  /** Half sizes of the boxes. */
  ha: number[];
  hb: number[];
  /** The band every box stays within: nearest point and farthest corner. */
  inner: number[];
  outer: number[];
  /** Boxes on every ring, and the parents whose arcs share a band, with their smallest gaps. */
  rings: Iterable<Row>;
  bands: Iterable<Row>;
  packed: Float64Array;
  /** The exact check of the whole layout at the given angles. */
  valid: (t: Float64Array) => boolean;
  /** Largest gap (length) a gap may grow to, unless it was wider. */
  maxGap: number;
}

const pairsOf = (row: Row) => (row.ids.length < 2 ? 0 : row.ids.length);
const wrapOf = (row: Row, k: number) => (k + 1 === row.ids.length ? TAU : 0);

/** The fanned angles (`amount` of the full fanning), or null if nothing moves. */
export function fanOut(S: Spreading, amount: number): Float64Array | null {
  const { parent, children, radius, ha, hb, packed } = S;
  const N = packed.length;
  const families: number[] = [];
  for (let i = 1; i < N; i++) if (S.level[i] >= 1 && children[i].length >= 2) families.push(i);
  if (families.length === 0) return null;

  // Descendants of i are the nodes i + 1 .. end[i] - 1 (pre-order).
  const end = Int32Array.from({ length: N }, (_, i) => i + 1);
  for (let i = N - 1; i > 0; i--) end[parent[i]] = Math.max(end[parent[i]], end[i]);
  const offset = Float64Array.from(packed, (x, i) => (i === 0 ? 0 : x - packed[parent[i]]));
  const factor = new Float64Array(N).fill(1);
  /** Slide of a middle child from its fanned place (radians); 0 for all others. */
  const shift = new Float64Array(N);
  /** Angles of the nodes from..to - 1 (whose parents are placed already) from the factors and `f` × the slides. */
  const place = (t: Float64Array, from: number, to: number, s: Float64Array, f: number) => {
    for (let i = from; i < to; i++) {
      const q = parent[i];
      t[i] = s[q] === 1 && t[q] === packed[q] && shift[i] === 0 ? packed[i] : t[q] + s[q] * offset[i] + f * shift[i];
    }
  };

  // Where every box sits in its ring's row and every parent in its band's row.
  const ringOf: Row[] = [];
  const ringPos = new Int32Array(N);
  for (const r of S.rings) r.ids.forEach((i, k) => ((ringOf[i] = r), (ringPos[i] = k)));
  const bandOf: Row[] = [];
  const bandPos = new Int32Array(N);
  for (const r of S.bands) r.ids.forEach((i, k) => ((bandOf[i] = r), (bandPos[i] = k)));

  // Accepted angles and cones (t, coneL, coneR), and a trial of the nodes in (lo, hi).
  const t = packed.slice();
  const coneL = new Float64Array(N);
  const coneR = new Float64Array(N);
  for (let i = 1; i < N; i++) [coneL[i], coneR[i]] = cone(t[i], radius[i], ha[i], hb[i]);
  const u = new Float64Array(N);
  const uL = new Float64Array(N);
  const uR = new Float64Array(N);
  let lo = 0;
  let hi = 0;
  const angle = (i: number) => (i > lo && i < hi ? u[i] : t[i]);
  const left = (i: number) => (i > lo && i < hi ? uL[i] : coneL[i]);
  const right = (i: number) => (i > lo && i < hi ? uR[i] : coneR[i]);
  /** The smallest free gap (length) of every ring at the accepted angles, recomputed when the ring moved. */
  const smallestGap = new Map<Row, number>();
  const smallestOf = (r: Row) => {
    let m = smallestGap.get(r);
    if (m === undefined) {
      m = Infinity;
      for (let k = 0; k < pairsOf(r); k++) {
        const a = r.ids[k];
        const b = r.ids[(k + 1) % r.ids.length];
        m = Math.min(m, (t[b] + wrapOf(r, k) - coneL[b] - (t[a] + coneR[a])) * radius[a]);
      }
      smallestGap.set(r, m);
    }
    return m;
  };
  /**
   * Clearance kept, a gap that shrinks stays at least the ring's smallest (max–min: even out,
   * don't push), and one that grows stays within `maxGap`.
   */
  const boxGapOk = (r: Row, k: number) => {
    const a = r.ids[k];
    const b = r.ids[(k + 1) % r.ids.length];
    const gap = angle(b) + wrapOf(r, k) - left(b) - (angle(a) + right(a));
    if (gap < r.min[k] - EPS) return false;
    const was = t[b] + wrapOf(r, k) - coneL[b] - (t[a] + coneR[a]);
    if (gap > was) return gap * radius[a] <= S.maxGap + EPS_LENGTH;
    return gap * radius[a] >= smallestOf(r) - EPS_LENGTH;
  };
  const arcFrom = (i: number) => Math.min(angle(i), angle(children[i][0]));
  const arcTo = (i: number) => Math.max(angle(i), angle(children[i].at(-1)!));
  const arcGapOk = (r: Row, k: number) =>
    arcFrom(r.ids[(k + 1) % r.ids.length]) + wrapOf(r, k) - arcTo(r.ids[k]) >= r.min[k] - EPS;
  /** The pairs on either side of position k of a row. */
  const sidesOk = (r: Row, k: number, ok: (r: Row, k: number) => boolean) => {
    const pairs = pairsOf(r);
    const before = k > 0 ? k - 1 : pairs - 1;
    return (before < 0 || ok(r, before)) && (k >= pairs || ok(r, k));
  };

  /**
   * The trial angles u (with cones) of the nodes lo + 1 .. hi - 1: kept if valid (checked for
   * what moves, plus the arc of `fanned` if ≥ 0), else dropped.
   */
  let clock = 0;
  /** When every node last moved (`clock` ticks with every kept step). */
  const moved = new Int32Array(N);
  const commit = (fanned: number): boolean => {
    let ok = true;
    for (let i = lo + 1; ok && i < hi; i++) {
      ok = closest(u[i], radius[i], ha[i], hb[i]) >= S.inner[i] - EPS_LENGTH &&
        farthest(u[i], radius[i], ha[i], hb[i]) <= S.outer[i] + EPS_LENGTH;
      ok &&= sidesOk(ringOf[i], ringPos[i], boxGapOk);
      if (ok && children[i].length > 0) ok = sidesOk(bandOf[i], bandPos[i], arcGapOk);
    }
    if (ok && fanned >= 0) ok = sidesOk(bandOf[fanned], bandPos[fanned], arcGapOk);
    if (ok) {
      t.set(u.subarray(lo + 1, hi), lo + 1);
      coneL.set(uL.subarray(lo + 1, hi), lo + 1);
      coneR.set(uR.subarray(lo + 1, hi), lo + 1);
      clock++;
      for (let i = lo + 1; i < hi; i++) {
        moved[i] = clock;
        smallestGap.delete(ringOf[i]);
      }
    }
    lo = hi = 0;
    return ok;
  };

  /** Family p fanned by s: kept if valid, else the factor is restored. */
  const tryFan = (p: number, s: number): boolean => {
    const was = factor[p];
    factor[p] = s;
    lo = p;
    hi = end[p];
    for (let i = lo + 1; i < hi; i++) {
      const q = parent[i];
      const tq = q === p ? t[p] : u[q];
      u[i] = tq + factor[q] * offset[i] + shift[i];
      [uL[i], uR[i]] = cone(u[i], radius[i], ha[i], hb[i]);
    }
    const ok = commit(p);
    if (!ok) factor[p] = was;
    return ok;
  };

  /** Middle child c and its subtree turned by d: kept if valid. */
  const trySlide = (c: number, d: number): boolean => {
    lo = c - 1;
    hi = end[c];
    for (let i = c; i < hi; i++) {
      u[i] = t[i] + d;
      [uL[i], uR[i]] = cone(u[i], radius[i], ha[i], hb[i]);
    }
    const ok = commit(-1);
    if (ok) shift[c] += d;
    return ok;
  };

  // A slide's target: free gaps (lengths) beside the subtree, left and right, with their radii.
  const gapL: number[] = [];
  const radL: number[] = [];
  const gapR: number[] = [];
  const radR: number[] = [];
  const smallest = (gap: number[], rad: number[], d: number) => {
    let m = Infinity;
    for (let k = 0; k < gap.length; k++) m = Math.min(m, gap[k] + d * rad[k]);
    return m;
  };
  /** The slide (radians) that evens out the smallest gaps on both sides of c's subtree, within the slack. */
  const target = (c: number): number => {
    const e = end[c];
    const inside = (j: number) => j >= c && j < e;
    let low = -Infinity;
    let high = Infinity;
    gapL.length = radL.length = gapR.length = radR.length = 0;
    for (let j = c; j < e; j++) {
      const r = ringOf[j];
      const k = ringPos[j];
      const n = r.ids.length;
      const kk = k > 0 ? k - 1 : n - 1;
      const a = r.ids[kk];
      if (!inside(a)) {
        const gap = t[j] + (k > 0 ? 0 : TAU) - coneL[j] - (t[a] + coneR[a]);
        low = Math.max(low, r.min[kk] - gap);
        gapL.push(gap * radius[j]);
        radL.push(radius[j]);
      }
      const b = r.ids[(k + 1) % n];
      if (!inside(b)) {
        const gap = t[b] + (k < n - 1 ? 0 : TAU) - coneL[b] - (t[j] + coneR[j]);
        high = Math.min(high, gap - r.min[k]);
        gapR.push(gap * radius[j]);
        radR.push(radius[j]);
      }
      if (children[j].length > 0) {
        const r = bandOf[j];
        const k = bandPos[j];
        const n = r.ids.length;
        const kk = k > 0 ? k - 1 : n - 1;
        const a = r.ids[kk];
        if (!inside(a)) low = Math.max(low, r.min[kk] - (arcFrom(j) + (k > 0 ? 0 : TAU) - arcTo(a)));
        const b = r.ids[(k + 1) % n];
        if (!inside(b)) high = Math.min(high, arcFrom(b) + (k < n - 1 ? 0 : TAU) - arcTo(j) - r.min[k]);
      }
    }
    if (gapL.length === 0 || gapR.length === 0 || !(low <= high)) return 0;
    low = Math.min(low, 0);
    high = Math.max(high, 0);
    // smallest left gap (rising with the slide) = smallest right gap (falling), within [low, high].
    const balance = (d: number) => smallest(gapL, radL, d) - smallest(gapR, radR, -d);
    if (balance(low) >= 0) return low;
    if (balance(high) <= 0) return high;
    let a = low;
    let b = high;
    for (let k = 0; k < BISECT; k++) {
      const m = (a + b) / 2;
      if (balance(m) < 0) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const middles = families.flatMap((p) => children[p].slice(1, -1));
  /** When every middle child's target was last worked out (-1: never). */
  const seen = new Int32Array(N).fill(-1);
  /** Whether anything a target reads (c's subtree, its ring and band neighbours, their arcs) moved since. */
  const stale = (c: number) => {
    const since = seen[c];
    const after = (i: number | undefined) => i !== undefined && moved[i] > since;
    for (let j = c; j < end[c]; j++) {
      if (moved[j] > since) return true;
      const r = ringOf[j];
      const n = r.ids.length;
      if (after(r.ids[(ringPos[j] + n - 1) % n]) || after(r.ids[(ringPos[j] + 1) % n])) return true;
      if (children[j].length === 0) continue;
      const b = bandOf[j];
      const m = b.ids.length;
      for (const q of [b.ids[(bandPos[j] + m - 1) % m], b.ids[(bandPos[j] + 1) % m]]) {
        if (after(q) || after(children[q][0]) || after(children[q].at(-1))) return true;
      }
    }
    return false;
  };
  /** Every middle child whose surroundings changed towards its target, in pre-order; whether any moved. */
  const slideAll = (): boolean => {
    let slid = false;
    for (const c of middles) {
      if (!stale(c)) continue;
      let d = target(c);
      if (Math.abs(d) * radius[c] >= MIN_SLIDE) {
        for (let h = 0; h <= SLIDE_HALVINGS; h++, d /= 2) {
          if (trySlide(c, d)) {
            slid = true;
            break;
          }
        }
      }
      seen[c] = clock;
    }
    return slid;
  };

  // Round-robin growth; per family the factor that widens it by one length unit at its children's ring.
  const unit = families.map((p) => {
    const kids = children[p];
    return 1 / (radius[kids[0]] * (packed[kids.at(-1)!] - packed[kids[0]]));
  });
  const step = new Float64Array(families.length);
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    step.fill(STEP);
    let grew = false;
    let active = families.length;
    let slid = middles.length > 0;
    for (let round = 0; active > 0 || (slid && round < MAX_ROUNDS); round++) {
      for (let k = 0; k < families.length; k++) {
        if (step[k] < MIN_STEP) continue;
        const p = families[k];
        if (tryFan(p, factor[p] + step[k] * unit[k])) grew = true;
        else if ((step[k] /= 2) < MIN_STEP) active--;
      }
      slid = middles.length > 0 && slideAll();
      grew ||= slid;
    }
    if (!grew) break;
  }
  if (families.every((p) => factor[p] === 1) && middles.every((c) => shift[c] === 0)) return null;

  // All of the fanning (`spread` 1) or part of it; less while the exact check fails.
  const full = factor.slice();
  const s = new Float64Array(N);
  const result = new Float64Array(N);
  result[0] = packed[0];
  for (let f = Math.min(1, amount), tries = 0; tries <= MAX_BACKOFF; f /= 2, tries++) {
    for (let i = 0; i < N; i++) s[i] = f === 1 ? full[i] : 1 + f * (full[i] - 1);
    place(result, 1, N, s, f);
    if (S.valid(result)) return result;
  }
  return null;
}
