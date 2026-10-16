/**
 * Radial descendant layout with upright (axis-aligned) boxes.
 *
 * The root sits in the centre; generation L sits on ring L. The difficulty with upright
 * boxes is that the angle a box occupies depends on where it is: on the left/right of the
 * circle only its height blocks neighbours, at the top/bottom its full width does. So the
 * space a node needs depends on its position, and its position on the space everything
 * needs. The layout resolves this by fixed-point iteration:
 *
 *  1. For every box, compute its exact angular footprint ("cone" from the centre, from
 *     its four corners) and its exact nearest/farthest distance at its current angle.
 *     Partner boxes switch between side-by-side and stacked, whichever needs less angle
 *     ('angle', and 'auto' to begin with; frozen after ORIENTATION_FREEZE iterations),
 *     unless `partnerMode` forces one arrangement.
 *  2. Ring radii follow from the nearest/farthest distances, so rings never touch.
 *  3. Reingold–Tilford style contour packing in angle space: each subtree carries, per
 *     generation, the extent of its cones; siblings are pushed apart until they clear at
 *     every generation. Deep subtrees can use the empty space beneath shallow neighbours.
 *  4. If a generation needs more than 360°, its ring grows (pushing the rings outside it;
 *     if growing one ring stops helping, every ring from it outwards is pushed), so boxes keep
 *     their `levelScale` size but the gaps between rings can become wide. Packing repeats.
 *  5. Slack is spread by scaling all angles around the root, and the loop repeats with the
 *     new angles until they settle.
 *  6. An exact final check confirms no two boxes overlap and no connector crosses a box;
 *     otherwise iteration continues.
 *  7. Slack pass: room was made at the angles of the moment, so the settled layout usually
 *     needs less than a turn. Grown rings come in by that slack and the loop goes on from 1., at most MAX_PASSES times while a pass gains at least
 *     MIN_GAIN; the best verified result is kept. Without any room made, nothing changes.
 *  8. 'auto' only, then: flattening passes. Partners side by side at the left/right of the
 *     circle (stacked at the top/bottom) save angle but reach far outwards, and a ring's
 *     spacing follows its deepest box, which leaves wide empty bands between generations.
 *     At a settled state, ring by ring from the outside in, the deepest partner boxes switch
 *     to the arrangement reaching outward least, as many as make an estimate of the drawing's
 *     radius smallest (the tree packed again with the rings moved inwards, plus the ring
 *     growth a generation then short of angle would cost); the root likewise takes the smaller
 *     circle. Where angle is plentiful partners are thus shallow, where it is scarce they keep
 *     saving angle. A pass is kept only if the drawing got no larger (radius and rectangle
 *     area), otherwise it is undone and the next may use half as
 *     much spare angle; at most MAX_PASSES passes in all. 'auto' thus starts from the 'angle'
 *     layout (at its default threshold) and keeps only what makes it smaller.
 *  9. Spreading pass (spread.ts, options `spread` and `lean`): the families packed tightly
 *     under their parents move into the free space beside them, with every parent centred over
 *     its children (`lean` 0), or leaning freely so the gaps on every ring become as even as
 *     possible (`lean` 1), or in between; only angles change.
 */
import type { TreeNode } from './model.ts';
import { walk } from './model.ts';
import { boundsOf, closest, cone, farthest, minRadiusFor, rayHalfLength } from './box.ts';
import { spreadLayout } from './spread.ts';

export interface LayoutOptions {
  /** Size of one person cell at scale 1. */
  cellWidth: number;
  cellHeight: number;
  /** Size multiplier per generation; the last entry applies to all deeper generations. */
  levelScale: number[];
  /** Minimum radial clearance between generations (connector arcs run there). */
  ringGap: number;
  /**
   * Minimum clearance between neighbouring boxes on a ring, in length units: between siblings
   * (same parent), and between boxes of different families (and across the 360° seam).
   */
  siblingGap: number;
  cousinGap: number;
  /** Direction the middle of the tree points to (radians; SVG coordinates, 0 = right, clockwise). */
  startAngle: number;
  /**
   * Partners beside or below the person: 'auto' keeps the drawing small (the least angle
   * first, then the arrangement reaching outward least wherever the angle allows, see the
   * header), 'angle' picks per box whichever needs less angle, 'side' and 'stacked' force one
   * arrangement for every box (the root included).
   */
  partnerMode: PartnerMode;
  /**
   * Hysteresis of 'angle': the other arrangement is chosen only if it needs less than this
   * fraction of the current one's angle (1 = always the smaller one).
   */
  partnerThreshold: number;
  /**
   * Spreading pass (spread.ts), 0–1: how far the families move from their tightest packing
   * towards boxes spaced as evenly as possible on every ring (0 = the packing as solved).
   */
  spread: number;
  /**
   * How far families of the spreading pass may lean, 0–1: 0 = every parent (generation ≥ 1)
   * exactly centred over its first and last child (an only child straight below it), as
   * 'centred'; 1 = families may lean freely, whichever way spaces the boxes most evenly, as
   * 'free'. In between, every angle is interpolated between the two (see spread.ts).
   */
  lean: number;
  /**
   * Largest gap the spreading pass widens a gap between neighbours on a ring to (length units
   * at the ring's radius): a gap that is comfortable needs not grow, so boxes are not pushed
   * apart into empty space (e.g. two siblings alone on the outermost ring). Gaps the packing
   * left wider stay possible.
   */
  maxGap: number;
}

export type PartnerMode = 'auto' | 'angle' | 'side' | 'stacked';

export const defaultOptions: LayoutOptions = {
  cellWidth: 110,
  cellHeight: 44,
  levelScale: [2, 1.7, 1.25, 1.1, 1],
  ringGap: 20,
  siblingGap: 4,
  cousinGap: 8,
  startAngle: -Math.PI / 2,
  partnerMode: 'auto',
  partnerThreshold: 0.85,
  spread: 0.5,
  lean: 0.5,
  maxGap: 100,
};

export interface PlacedNode {
  node: TreeNode;
  level: number;
  /** 1 + number of partners. */
  cells: number;
  /** Partners below the person instead of beside. */
  stacked: boolean;
  /** Size of one person cell; the same for the whole generation (base cell × its scale). */
  cellWidth: number;
  cellHeight: number;
  /** Box centre in polar coordinates. `angle` is unwrapped: siblings increase monotonically. */
  angle: number;
  radius: number;
  /** Box centre and size (axis-aligned). */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Where the ray from the centre at `angle` enters and leaves the box (connector end points). */
  innerRadius: number;
  outerRadius: number;
  /** Radius of the arc connecting this node to its children (0 for leaves and the root). */
  arcRadius: number;
}

export interface Layout {
  /** Pre-order; nodes[0] is the root. */
  nodes: PlacedNode[];
  /** Per generation: radius of the box centres; radii[0] = 0. */
  radii: number[];
  /** Nearest box point / farthest box corner per generation. */
  ringInner: number[];
  ringOuter: number[];
  /** Farthest box corner from the centre. */
  extent: number;
  /** Rectangle enclosing all boxes (the root need not be in its middle). */
  bounds: Bounds;
  /** Size multiplier per generation (`levelScale`, its last entry repeated). */
  scales: number[];
  /** Fixed-point iterations needed. */
  iterations: number;
  options: LayoutOptions;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function layoutTree(root: TreeNode, options: Partial<LayoutOptions> = {}): Layout {
  const o: LayoutOptions = { ...defaultOptions, ...options };
  return spreadLayout(solve(root, collectLevels(root), o));
}

function collectLevels(root: TreeNode): TreeNode[][] {
  const levels: TreeNode[][] = [];
  for (const n of walk(root)) (levels[n.level] ??= []).push(n);
  return levels;
}

const TAU = 2 * Math.PI;
const MAX_ITERATIONS = 3000;
const SETTLED = 1e-6;
const ORIENTATION_FREEZE = 40;
/**
 * Angles slow to settle move only half way to their targets (from iteration 200). They can
 * still swing between two states: with only two children, the root's ring is nothing but their
 * two gaps, and a box just above the horizontal needs more angle towards the top than towards
 * the seam (just below it, the reverse), so the gaps trade sizes on every step. From SWING_FROM
 * on, whenever the angles have turned back SWING_TURNS times in a row, the step halves again
 * (until they settle).
 */
const SWING_FROM = 1000;
const SWING_TURNS = 10;
/** Slack passes: at most this many, and none after one that gained less than MIN_GAIN. */
const MAX_PASSES = 10;
const MIN_GAIN = 0.01;
/** 'auto': starts like 'angle' with this hysteresis (`partnerThreshold` is for 'angle' only). */
const AUTO_THRESHOLD = 0.85;
/** 'auto': no flattening pass once the share of the spare angle it may use is below this. */
const MIN_SPARE_SHARE = 0.25;

/** The boxes of one generation, sharing one radius. */
interface Ring {
  level: number;
  /** Node indices in angular order. */
  ids: number[];
  /** Lowest radius allowed; raised to make room. */
  floor: number;
  radius: number;
  /** Nearest box point / farthest box corner. */
  inner: number;
  outer: number;
}

/** Per depth (index d): extent of cones, relative to the subtree root. */
interface Contour {
  depth: number;
  coneMin: number[];
  coneMax: number[];
}

function emptyContour(depth: number): Contour {
  return {
    depth,
    coneMin: new Array(depth).fill(Infinity),
    coneMax: new Array(depth).fill(-Infinity),
  };
}

function mergeContour(into: Contour, c: Contour, offset: number, depthShift = 0) {
  for (let d = 0; d < c.depth; d++) {
    const dd = d + depthShift;
    into.coneMin[dd] = Math.min(into.coneMin[dd], offset + c.coneMin[d]);
    into.coneMax[dd] = Math.max(into.coneMax[dd], offset + c.coneMax[d]);
  }
}

/** Growth factor of a ring for a span `need` times what fits (damped). */
function growth(need: number): number {
  return 1 + Math.max(0.01, (need - 1) * 0.6);
}

function solve(root: TreeNode, levels: TreeNode[][], o: LayoutOptions): Layout {
  const maxLevel = levels.length - 1;
  const nodes = [...walk(root)];
  const N = nodes.length;
  const index = new Map(nodes.map((n, i) => [n, i]));
  const level = nodes.map((n) => n.level);
  const cells = nodes.map((n) => 1 + n.partners.length);

  // Cell size per generation.
  const scales = levels.map((_, l) => o.levelScale[Math.min(l, o.levelScale.length - 1)]);
  const cw = level.map((l) => o.cellWidth * scales[l]);
  const ch = level.map((l) => o.cellHeight * scales[l]);

  // 'angle' and 'auto' start side by side and switch per box; forced modes never switch.
  const stacked: boolean[] = cells.map((c) => o.partnerMode === 'stacked' && c > 1);
  const halfW = (i: number) => (stacked[i] ? cw[i] : cells[i] * cw[i]) / 2;
  const halfH = (i: number) => (stacked[i] ? cells[i] * ch[i] : ch[i]) / 2;

  // The root's circle; only 'auto' may switch the root's partners (at a pass, see `flatten`).
  let rootOuter = Math.hypot(halfW(0), halfH(0));
  const theta = initialAngles(root, nodes, index, o.startAngle);

  // One ring per generation, each keeping `ringGap` from the one inside it.
  const rings: Ring[] = levels.map((nodesAt, l) =>
    ({ level: l, ids: nodesAt.map((n) => index.get(n)!), floor: 0, radius: 0, inner: 0, outer: 0 }));
  const ringOf = level.map((l) => rings[l]);
  /** Radius per generation, for the packing. */
  const levelRadius: number[] = new Array(maxLevel + 1).fill(0);

  const left = new Float64Array(N);
  const right = new Float64Array(N);
  const x = new Float64Array(N);

  const computeRadii = () => {
    rings[0].outer = rootOuter;
    for (let l = 1; l <= maxLevel; l++) {
      const g = rings[l];
      const target = rings[l - 1].outer + o.ringGap;
      let r = g.floor;
      for (const i of g.ids) r = Math.max(r, minRadiusFor(theta[i], halfW(i), halfH(i), target));
      g.radius = r;
      let near = Infinity;
      let far = 0;
      for (const i of g.ids) {
        near = Math.min(near, closest(theta[i], r, halfW(i), halfH(i)));
        far = Math.max(far, farthest(theta[i], r, halfW(i), halfH(i)));
      }
      g.inner = near;
      g.outer = far;
    }
    for (let l = 0; l <= maxLevel; l++) levelRadius[l] = rings[l].radius;
  };

  const computeCones = () => {
    for (let i = 1; i < N; i++) {
      const [l, r] = cone(theta[i], ringOf[i].radius, halfW(i), halfH(i));
      left[i] = l;
      right[i] = r;
    }
  };

  // 'angle': partners side by side or stacked, whichever needs less angle here (with hysteresis).
  const chooseLeastAngle = (threshold: number) => {
    for (let i = 1; i < N; i++) {
      if (cells[i] === 1) continue;
      const r = ringOf[i].radius;
      const side = cone(theta[i], r, (cells[i] * cw[i]) / 2, ch[i] / 2);
      const stack = cone(theta[i], r, cw[i] / 2, (cells[i] * ch[i]) / 2);
      const sideSize = side[0] + side[1];
      const stackSize = stack[0] + stack[1];
      if (!stacked[i] && stackSize < threshold * sideSize) stacked[i] = true;
      else if (stacked[i] && sideSize < threshold * stackSize) stacked[i] = false;
    }
  };

  /** Gap between neighbours at generation l, as an angle. */
  const gapAngle = (l: number, d: number) => (d === 0 ? o.siblingGap : o.cousinGap) / levelRadius[l];

  /** Smallest shift of B (relative to A) so that B clears A at every common generation. */
  const separation = (a: Contour, b: Contour, firstLevel: number): number => {
    let s = -Infinity;
    const depth = Math.min(a.depth, b.depth);
    for (let d = 0; d < depth; d++) {
      // Cones must not overlap; an empty depth (±Infinity) gives -Infinity, i.e. no constraint.
      s = Math.max(s, a.coneMax[d] - b.coneMin[d] + gapAngle(firstLevel + d, d));
    }
    return s;
  };

  const pack = (node: TreeNode): Contour => {
    const i = index.get(node)!;
    const childContours = node.children.map(pack);
    const contour = emptyContour(1 + Math.max(0, ...childContours.map((c) => c.depth)));
    contour.coneMin[0] = i === 0 ? 0 : -left[i];
    contour.coneMax[0] = i === 0 ? 0 : right[i];
    if (childContours.length === 0) return contour;

    const firstLevel = node.level + 1;
    const n = childContours.length;
    const maxDepth = contour.depth - 1;

    // Left-to-right packing.
    const fromLeft: number[] = [0];
    let acc = emptyContour(maxDepth);
    mergeContour(acc, childContours[0], 0);
    for (let k = 1; k < n; k++) {
      fromLeft[k] = separation(acc, childContours[k], firstLevel);
      mergeContour(acc, childContours[k], fromLeft[k]);
    }
    // Right-to-left packing; averaging both removes the left bias of plain Reingold–Tilford.
    // Both satisfy every pairwise clearance constraint, so their average does too.
    const fromRight: number[] = new Array(n);
    fromRight[n - 1] = 0;
    acc = emptyContour(maxDepth);
    mergeContour(acc, childContours[n - 1], 0);
    for (let k = n - 2; k >= 0; k--) {
      fromRight[k] = -separation(childContours[k], acc, firstLevel);
      mergeContour(acc, childContours[k], fromRight[k]);
    }
    const xs = fromLeft.map((v, k) => (v + fromRight[k] - fromRight[0]) / 2);

    // Parent sits centred over its first and last child.
    const centre = (xs[0] + xs[n - 1]) / 2;
    childContours.forEach((c, k) => {
      const ci = index.get(node.children[k])!;
      x[ci] = xs[k] - centre;
      mergeContour(contour, c, x[ci], 1);
    });
    return contour;
  };

  /** Exact check at the current angles: neighbouring cones on every ring are disjoint (also across the seam). */
  const verify = (): boolean => {
    const eps = 1e-9;
    for (const g of rings) {
      const ids = g.ids;
      if (g.level === 0 || ids.length < 2) continue;
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k];
        const b = ids[(k + 1) % ids.length];
        const wrap = k + 1 === ids.length ? TAU : 0;
        if (theta[b] + wrap - left[b] < theta[a] + right[a] - eps) return false;
      }
    }
    return true;
  };

  /**
   * 'auto', at a settled state: partner boxes reaching deeper than they need switch to the
   * arrangement reaching outward least where that makes the drawing smaller. A ring's spacing
   * follows its deepest box ("reach" = farthest corner − nearest point), so per ring,
   * outermost first, it tries switching its 0, 1, 2, ... deepest partner boxes and keeps the
   * number with the smallest estimated radius: the tree packed again at the current angles with
   * the rings moved inwards, plus how far a generation that then needs more than its room would
   * push its ring out (radius × overflow). A generation's room is its span plus `spareShare` of what is left of the turn.
   * On a tie the shallower ring wins. Last, the root (needing no angle itself) takes the
   * arrangement with the smaller circle if that is estimated smaller too. Returns false if
   * nothing switched.
   */
  const flatten = (): boolean => {
    const before = spans.slice();
    const estimate = (): number => {
      computeRadii();
      computeCones();
      measure();
      let push = 0;
      for (let l = 1; l < before.length; l++) {
        const over = spans[l] / (before[l] + spareShare * (TAU - before[l])) - 1;
        if (over <= 0) continue;
        push = Math.max(push, levelRadius[l] * over);
      }
      return extent() + push;
    };

    // The state as it is: every generation within its room.
    let current = extent();
    let switched = false;
    for (const g of rings.slice(1).reverse()) {
      // Partner boxes that could reach less, and the deepest reach of the other boxes.
      const deep: { i: number; reach: number; shallow: number }[] = [];
      let kept = 0;
      for (const i of g.ids) {
        const reach = (a: number, b: number) => farthest(theta[i], g.radius, a, b) - closest(theta[i], g.radius, a, b);
        const now = reach(halfW(i), halfH(i));
        const other = cells[i] > 1
          ? (stacked[i] ? reach((cells[i] * cw[i]) / 2, ch[i] / 2) : reach(cw[i] / 2, (cells[i] * ch[i]) / 2))
          : Infinity;
        if (other < now) deep.push({ i, reach: now, shallow: other });
        else kept = Math.max(kept, now);
      }
      if (deep.length === 0) continue;
      deep.sort((p, q) => q.reach - p.reach);
      const was = deep.map((d) => stacked[d.i]);
      /** Switches the k deepest; returns how far the ring then reaches. */
      const take = (k: number): number => {
        let reach = Math.max(kept, deep[k]?.reach ?? 0);
        deep.forEach((d, j) => {
          stacked[d.i] = j < k ? !was[j] : was[j];
          if (j < k) reach = Math.max(reach, d.shallow);
        });
        return reach;
      };
      // Switching more saves at most the reach left to save but needs more angle, so the scan
      // stops once that could no longer beat the best estimate.
      const least = Math.max(kept, ...deep.map((d) => d.shallow));
      let k = 0;
      let smallest = current;
      let shallowest = Math.max(kept, deep[0].reach);
      for (let j = 1; j <= deep.length; j++) {
        const reach = take(j);
        const e = estimate();
        if (e < smallest || (e === smallest && reach < shallowest)) {
          smallest = e;
          shallowest = reach;
          k = j;
        }
        if (e - (reach - least) > smallest) break;
      }
      take(k);
      current = smallest;
      if (k > 0) switched = true;
    }

    if (cells[0] > 1) {
      const previous = rootOuter;
      stacked[0] = !stacked[0];
      rootOuter = Math.hypot(halfW(0), halfH(0));
      if (rootOuter < previous && estimate() < current) switched = true;
      else {
        stacked[0] = !stacked[0];
        rootOuter = previous;
      }
    }
    // Back to the state chosen (the same as before if nothing switched).
    computeRadii();
    computeCones();
    measure();
    return switched;
  };

  /**
   * Room is made at the angles of the moment and never undone, so once the angles settle
   * the widest generation usually needs less than a turn and the rest has become wider gaps.
   * A slack pass hands it back: raised floors come down by the share of the turn in use. The
   * iteration then goes on, making room again where that was too much. Returns false if there
   * was nothing to give back.
   */
  const giveBackSlack = (maxSpan: number): boolean => {
    const usage = maxSpan / TAU;
    let changed = false;
    for (const g of rings) {
      if (g.floor === 0) continue;
      g.floor *= usage;
      changed = true;
    }
    return changed;
  };

  /** Farthest box corner. */
  const extent = (): number => Math.max(rootOuter, ...rings.map((g) => g.outer));

  /** Area of the rectangle around all boxes. */
  const boundsArea = (): number => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      const r = i === 0 ? 0 : ringOf[i].radius;
      const cx = r * Math.cos(theta[i]);
      const cy = r * Math.sin(theta[i]);
      minX = Math.min(minX, cx - halfW(i));
      maxX = Math.max(maxX, cx + halfW(i));
      minY = Math.min(minY, cy - halfH(i));
      maxY = Math.max(maxY, cy + halfH(i));
    }
    return (maxX - minX) * (maxY - minY);
  };

  /** What a slack pass should improve: the farthest box (negated, larger is better). */
  const quality = (): number => -extent();

  // The best settled (and verified) state so far, to return to after a pass that lost.
  let best: {
    quality: number; extent: number; area: number;
    theta: Float64Array; floors: number[]; stacked: boolean[];
  } | null = null;
  let passes = 0;
  // 'auto': partners have been switched by `flatten` (no per-iteration choice after that); the
  // pass running was started by it; the share of the spare angle the next one may use; the
  // arrangements tried by the pass running and by the last one that lost.
  let flattened = false;
  let flattening = false;
  let spareShare = 1;
  let tried = '';
  let lostTry = '';

  /**
   * At a settled, verified state: starts a slack pass or, for 'auto' once those are done, a
   * flattening pass (true), or ends with the best state. A flattening pass is kept if it is no
   * worse and the drawing grew neither outwards nor in the area of its rectangle (so the
   * coverage did not drop); otherwise the best state returns and the next one may use half as
   * much spare angle.
   */
  const nextPass = (maxSpan: number): boolean => {
    const q = quality();
    const gain = best ? (q - best.quality) / Math.abs(best.quality) : Infinity;
    const area = o.partnerMode === 'auto' ? boundsArea() : 0;
    const lost = flattening && !(best && q >= best.quality && extent() <= best.extent && area <= best.area);
    if (!best || (flattening ? !lost : q > best.quality)) {
      best = {
        quality: q, extent: extent(), area,
        theta: theta.slice(), floors: rings.map((g) => g.floor), stacked: stacked.slice(),
      };
    } else if (lost) {
      spareShare /= 2;
      lostTry = tried;
    }
    flattening = false;
    if (gain >= MIN_GAIN && passes < MAX_PASSES && maxSpan < TAU * (1 - MIN_GAIN) && giveBackSlack(maxSpan)) {
      passes++;
      return true;
    }
    if (q < best.quality || lost) {
      theta.set(best.theta);
      best.floors.forEach((f, k) => (rings[k].floor = f));
      best.stacked.forEach((v, i) => (stacked[i] = v));
      rootOuter = Math.hypot(halfW(0), halfH(0));
      computeRadii();
      computeCones();
      if (o.partnerMode === 'auto') measure();
    }
    if (o.partnerMode === 'auto' && passes < MAX_PASSES && spareShare >= MIN_SPARE_SHARE) {
      const previous = stacked.slice();
      if (flatten()) {
        tried = stacked.join();
        if (tried !== lostTry) {
          passes++;
          flattened = true;
          flattening = true;
          return true;
        }
        // The same switches as the pass that just lost.
        previous.forEach((v, i) => (stacked[i] = v));
        rootOuter = Math.hypot(halfW(0), halfH(0));
        computeRadii();
        computeCones();
      }
    }
    return false;
  };

  const spans: number[] = new Array(maxLevel + 1).fill(0);
  /**
   * Packs the tree at the current cones and fills `spans`. Every generation must fit into one
   * turn, including the clearance across the seam. Returns the widest generation.
   */
  const measure = (): number => {
    const contour = pack(root);
    let worst = 1;
    let maxSpan = 0;
    for (let l = 1; l < contour.depth; l++) {
      spans[l] = contour.coneMax[l] - contour.coneMin[l] + o.cousinGap / levelRadius[l];
      if (spans[l] > maxSpan) {
        maxSpan = spans[l];
        worst = l;
      }
    }
    return worst;
  };

  let iterations = 0;
  let previousNeed = Infinity;
  // Share of the way to their targets the angles move; their last step; how many steps in a
  // row went back (see SWING_FROM).
  let damping = 1;
  const step = new Float64Array(N);
  let turns = 0;
  computeRadii();
  for (;;) {
    if (++iterations > MAX_ITERATIONS) throw new Error('Radial layout did not converge');
    if (iterations <= ORIENTATION_FREEZE) {
      if (o.partnerMode === 'angle') chooseLeastAngle(o.partnerThreshold);
      else if (o.partnerMode === 'auto' && !flattened) chooseLeastAngle(AUTO_THRESHOLD);
    }
    computeRadii();
    computeCones();
    const worst = measure();
    if (maxLevel === 0) break;
    const maxSpan = spans[worst];
    const ratio = maxSpan / TAU;
    if (ratio > 1) {
      // Make room for the widest generation: grow its ring. If growing a single ring stopped
      // helping, push that ring and everything outside it.
      const need = ratio;
      const step = growth(need);
      const stalled = need > previousNeed * 0.999;
      const until = stalled ? maxLevel : worst;
      for (let k = worst; k <= until; k++) rings[k].floor = rings[k].radius * step;
      previousNeed = need;
      continue;
    }
    previousNeed = Infinity;

    // Spread the slack uniformly, then repeat with footprints at the new angles.
    const scale = TAU / maxSpan;
    if (iterations > 200 && damping === 1) damping = 0.5;
    let moved = 0;
    let back = 0;
    for (let i = 1; i < N; i++) {
      const target = o.startAngle + scale * absoluteOffset(nodes[i], index, x);
      moved = Math.max(moved, Math.abs(target - theta[i]));
      back -= (target - theta[i]) * step[i];
      step[i] = target - theta[i];
      theta[i] += damping * step[i];
    }
    turns = back > 0 ? turns + 1 : 0;
    if (iterations > SWING_FROM && turns >= SWING_TURNS) {
      damping /= 2;
      turns = 0;
    }
    if (moved > SETTLED) continue;
    // Settled: what follows is a new state, it starts with half steps again.
    damping = Math.max(damping, 0.5);

    computeRadii();
    computeCones();
    if (verify() && !nextPass(maxSpan)) break;
  }

  const placed: PlacedNode[] = nodes.map((n, i) => {
    const r = i === 0 ? 0 : ringOf[i].radius;
    const a = halfW(i);
    const b = halfH(i);
    const angle = i === 0 ? o.startAngle : theta[i];
    const ray = i === 0 ? rootOuter : rayHalfLength(angle, a, b);
    // The connector arc runs midway between this box's ring and its children's.
    const arcRadius = i > 0 && n.children.length > 0 ? (ringOf[i].outer + ringOf[index.get(n.children[0])!].inner) / 2 : 0;
    return {
      node: n, level: level[i], cells: cells[i], stacked: stacked[i],
      cellWidth: cw[i], cellHeight: ch[i], angle, radius: r,
      cx: r * Math.cos(angle), cy: r * Math.sin(angle), width: 2 * a, height: 2 * b,
      innerRadius: Math.max(0, r - ray), outerRadius: r + ray, arcRadius,
    };
  });

  const ringOuter = rings.map((g) => g.outer);
  return {
    nodes: placed,
    radii: rings.map((g) => g.radius),
    ringInner: rings.map((g) => g.inner),
    ringOuter,
    extent: Math.max(rootOuter, ...ringOuter),
    bounds: boundsOf(placed),
    scales,
    iterations,
    options: o,
  };
}

/** Angle of a node relative to the root, from the per-parent offsets. */
function absoluteOffset(node: TreeNode, index: Map<TreeNode, number>, x: Float64Array): number {
  let sum = 0;
  for (let n: TreeNode | null = node; n && n.parent; n = n.parent) sum += x[index.get(n)!];
  return sum;
}

/** Starting point for the iteration: wedges proportional to leaf counts. */
function initialAngles(root: TreeNode, nodes: TreeNode[], index: Map<TreeNode, number>, start: number): Float64Array {
  const theta = new Float64Array(nodes.length).fill(start);
  const leaves = new Map<TreeNode, number>();
  const count = (n: TreeNode): number => {
    const c = n.children.length === 0 ? 1 : n.children.reduce((s, k) => s + count(k), 0);
    leaves.set(n, c);
    return c;
  };
  count(root);
  const assign = (n: TreeNode, from: number, span: number) => {
    let at = from;
    for (const c of n.children) {
      const w = (span * leaves.get(c)!) / leaves.get(n)!;
      theta[index.get(c)!] = at + w / 2;
      assign(c, at, w);
      at += w;
    }
  };
  assign(root, start - Math.PI, TAU);
  return theta;
}
