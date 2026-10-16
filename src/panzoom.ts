/**
 * Mouse wheel / drag / pinch zoom and pan for an SVG, plus animated button/keyboard zoom and
 * pan. The view is the SVG's viewBox, not a transform on the scene group: Chrome draws a group
 * whose transform alone changed by scaling its previous picture, so after zooming in the tree
 * stayed blurry until something else repainted it; a new viewBox is always drawn afresh. Once the scene bounds are known (`setBounds`/`fit`) the view is limited so
 * nobody gets lost: zoom between `MIN_FIT_FACTOR` × the fit-to-window zoom and `MAX_SCALE`,
 * and the point in the middle of the view stays inside the tree (the ellipse inscribed in its
 * bounding rectangle; the tree is radial, so the rectangle's corners are empty).
 */
import type { Bounds } from './layout.ts';

const FIT_MARGIN = 0.04;
/** Duration of button/keyboard moves in ms. */
const ANIMATION_MS = 200;

/** Screen transform: scene point p is drawn at (x + k·p.x, y + k·p.y). */
export interface View {
  x: number;
  y: number;
  k: number;
}

/** Smallest zoom, as a fraction of the zoom that fits the whole tree into the view. */
export const MIN_FIT_FACTOR = 0.5;
/** Largest zoom (scene units are pixels at zoom 1; names are then several times their size). */
export const MAX_SCALE = 6;

/** Zoom range for a view whose fit-to-window zoom is `fit`. */
export function scaleLimits(fit: number): { min: number; max: number } {
  if (!(fit > 0) || !Number.isFinite(fit)) return { min: 0.001, max: MAX_SCALE };
  return { min: fit * MIN_FIT_FACTOR, max: Math.max(MAX_SCALE, fit * 2) };
}

/**
 * Clamps the zoom to `limits` and moves the view so that the scene point in its middle lies
 * inside the ellipse inscribed in `bounds` (the zoom stays as clamped).
 */
export function constrainView(
  view: View,
  width: number,
  height: number,
  bounds: Bounds,
  limits: { min: number; max: number },
): View {
  const k = Math.min(limits.max, Math.max(limits.min, view.k));
  // Scene point in the middle of the view; zooming keeps it.
  let cx = (width / 2 - view.x) / view.k;
  let cy = (height / 2 - view.y) / view.k;
  const mx = (bounds.minX + bounds.maxX) / 2;
  const my = (bounds.minY + bounds.maxY) / 2;
  const rx = (bounds.maxX - bounds.minX) / 2;
  const ry = (bounds.maxY - bounds.minY) / 2;
  if (rx > 0 && ry > 0) {
    const u = (cx - mx) / rx;
    const v = (cy - my) / ry;
    const r = Math.hypot(u, v);
    if (r > 1) {
      cx = mx + (u / r) * rx;
      cy = my + (v / r) * ry;
    }
  }
  return { x: width / 2 - k * cx, y: height / 2 - k * cy, k };
}

/** Rectangle in view pixels (relative to the SVG's top-left corner). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Space kept between the tree and a floating obstacle (the button group), in pixels. */
const OBSTACLE_GAP = 8;

/** `bounds` fitted into the view area [0, width] × [0, height], centred, with `margin`. */
function fitInto(bounds: Bounds, width: number, height: number, margin: number): View {
  const k = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)) / (1 + 2 * margin);
  return {
    x: width / 2 - (k * (bounds.minX + bounds.maxX)) / 2,
    y: height / 2 - (k * (bounds.minY + bounds.maxY)) / 2,
    k,
  };
}

/**
 * Whether the tree drawn with `view` reaches into `rect` (plus the gap). The tree is radial,
 * so its outline is the ellipse inscribed in `bounds`, not the rectangle's empty corners.
 */
function treeHits(view: View, bounds: Bounds, rect: Rect): boolean {
  const cx = view.x + (view.k * (bounds.minX + bounds.maxX)) / 2;
  const cy = view.y + (view.k * (bounds.minY + bounds.maxY)) / 2;
  const rx = (view.k * (bounds.maxX - bounds.minX)) / 2;
  const ry = (view.k * (bounds.maxY - bounds.minY)) / 2;
  // Nearest point of the rectangle to the ellipse centre, in units where the ellipse is a circle.
  const nx = Math.max(rect.left - OBSTACLE_GAP, Math.min(cx, rect.right + OBSTACLE_GAP));
  const ny = Math.max(rect.top - OBSTACLE_GAP, Math.min(cy, rect.bottom + OBSTACLE_GAP));
  return ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2 < 1;
}

/**
 * The fit, changed only as much as a floating obstacle in the bottom-right corner needs: if the
 * plain fit reaches into `obstacle`, the view area is trimmed from the right or from the bottom
 * by the smallest amount that clears it (whichever keeps the larger zoom). Without an
 * overlap, or if no trim helps, it is the plain fit.
 */
export function fitAvoiding(
  bounds: Bounds,
  width: number,
  height: number,
  margin: number,
  obstacle: Rect | null,
): View {
  const plain = fitInto(bounds, width, height, margin);
  if (!obstacle || !treeHits(plain, bounds, obstacle)) return plain;
  const trimmed = (side: 'right' | 'bottom'): View | null => {
    const at = (s: number) =>
      side === 'right' ? fitInto(bounds, width - s, height, margin) : fitInto(bounds, width, height - s, margin);
    // At most the whole obstacle size plus the gap: more never helps.
    const max = side === 'right' ? width - obstacle.left + OBSTACLE_GAP : height - obstacle.top + OBSTACLE_GAP;
    if (max <= 0 || treeHits(at(max), bounds, obstacle)) return null;
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (treeHits(at(mid), bounds, obstacle)) lo = mid;
      else hi = mid;
    }
    return at(hi);
  };
  const right = trimmed('right');
  const bottom = trimmed('bottom');
  if (right && bottom) return right.k >= bottom.k ? right : bottom;
  return right ?? bottom ?? plain;
}

export class PanZoom {
  private x = 0;
  private y = 0;
  private k = 1;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  /** View size the transform was last adjusted to. */
  private width = 0;
  private height = 0;
  /** Scene rectangle the limits refer to (none until the tree is drawn). */
  private bounds: Bounds | null = null;
  /** Running animation: its frame request and where it ends (the base for further clicks). */
  private frame = 0;
  private goal: View | null = null;
  /** Element floating over the view that `fit` keeps the tree clear of (the buttons). */
  private obstacle: HTMLElement | null = null;

  private readonly svg: SVGSVGElement;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
    svg.addEventListener('pointerup', (e) => this.onPointerUp(e));
    svg.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    svg.addEventListener('dblclick', (e) => {
      const p = this.local(e);
      this.zoomAt(p.x, p.y, e.shiftKey ? 0.5 : 2);
    });
    // The view changes size when the sidebar opens/closes, the window resizes or a phone rotates.
    new ResizeObserver(() => this.onResize()).observe(svg);
  }

  /** The fit keeps the tree clear of `element` (a group floating over the bottom-right corner). */
  setObstacle(element: HTMLElement) {
    this.obstacle = element;
  }

  /** Sets the scene rectangle the zoom and pan limits refer to (keeps the view). */
  setBounds(bounds: Bounds) {
    this.bounds = bounds;
    this.update();
  }

  /**
   * Fits the scene rectangle into the view, centred, with a margin (fraction of its size) on
   * each side; `animate` glides there ("Celý strom").
   */
  fit(bounds: Bounds | null = this.bounds, animate = false) {
    if (!bounds) return;
    this.bounds = bounds;
    const rect = this.svg.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    const view = fitAvoiding(bounds, rect.width, rect.height, FIT_MARGIN, this.obstacleRect(rect));
    if (animate) {
      this.animateTo(view);
    } else {
      this.stop();
      this.set(view);
    }
  }

  /** Zoom at which `fit` shows the rectangle in the current view size. */
  fitScale(bounds: Bounds, margin = FIT_MARGIN): number {
    const rect = this.svg.getBoundingClientRect();
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const k = Math.min(rect.width / width, rect.height / height) / (1 + 2 * margin);
    return Number.isFinite(k) && k > 0 ? k : 1;
  }

  /** Zoom in/out by `factor` around the middle of the view, animated (buttons, keys). */
  zoomBy(factor: number) {
    const base = this.goal ?? this.view();
    const cx = (this.width / 2 - base.x) / base.k;
    const cy = (this.height / 2 - base.y) / base.k;
    const k = base.k * factor;
    this.animateTo({ x: this.width / 2 - k * cx, y: this.height / 2 - k * cy, k });
  }

  /** Moves the view by a fraction of its size, animated; positive `fx` shows more on the right. */
  panBy(fx: number, fy: number) {
    const base = this.goal ?? this.view();
    this.animateTo({ x: base.x - fx * this.width, y: base.y - fy * this.height, k: base.k });
  }

  /** Immediate zoom keeping the scene point under (px, py) fixed (wheel, pinch, double-click). */
  zoomAt(px: number, py: number, factor: number) {
    this.stop();
    const k = this.clampScale(this.k * factor);
    this.x = px - ((px - this.x) * k) / this.k;
    this.y = py - ((py - this.y) * k) / this.k;
    this.k = k;
    this.update();
  }

  /** The obstacle's rectangle relative to the view, if it is shown. */
  private obstacleRect(view: DOMRect): Rect | null {
    const r = this.obstacle?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { left: r.left - view.left, top: r.top - view.top, right: r.right - view.left, bottom: r.bottom - view.top };
  }

  private view(): View {
    return { x: this.x, y: this.y, k: this.k };
  }

  private limits() {
    return scaleLimits(this.bounds ? this.fitScale(this.bounds) : NaN);
  }

  private clampScale(k: number) {
    const { min, max } = this.limits();
    return Math.min(max, Math.max(min, k));
  }

  private constrain(view: View): View {
    if (!this.bounds || this.width <= 0 || this.height <= 0) {
      return { ...view, k: this.clampScale(view.k) };
    }
    return constrainView(view, this.width, this.height, this.bounds, this.limits());
  }

  private set(view: View) {
    const v = this.constrain(view);
    this.x = v.x;
    this.y = v.y;
    this.k = v.k;
    this.apply();
  }

  /** Re-applies the limits to the current transform. */
  private update() {
    this.set(this.view());
  }

  /** Glides to `view` (limited first): the middle point moves linearly, the zoom geometrically. */
  private animateTo(view: View) {
    const to = this.constrain(view);
    this.stop();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.set(to);
      return;
    }
    const from = this.view();
    const w = this.width / 2;
    const h = this.height / 2;
    const fc = { x: (w - from.x) / from.k, y: (h - from.y) / from.k };
    const tc = { x: (w - to.x) / to.k, y: (h - to.y) / to.k };
    const start = performance.now();
    this.goal = to;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const e = 1 - (1 - t) ** 3;
      const k = from.k * (to.k / from.k) ** e;
      const cx = fc.x + (tc.x - fc.x) * e;
      const cy = fc.y + (tc.y - fc.y) * e;
      this.x = w - k * cx;
      this.y = h - k * cy;
      this.k = k;
      this.apply();
      if (t < 1) {
        this.frame = requestAnimationFrame(step);
      } else {
        this.frame = 0;
        this.goal = null;
        this.set(to);
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Stops a running animation where it is (any direct interaction takes over). */
  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.goal = null;
  }

  /** Keeps the scene point in the middle of the view where it was. */
  private onResize() {
    const rect = this.svg.getBoundingClientRect();
    if (this.width > 0 && this.height > 0) {
      this.stop();
      this.x += (rect.width - this.width) / 2;
      this.y += (rect.height - this.height) / 2;
    }
    this.width = rect.width;
    this.height = rect.height;
    if (rect.width > 0 && rect.height > 0) this.update();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const speed = e.ctrlKey ? 0.01 : 0.0015;
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * speed));
  }

  private onPointerDown(e: PointerEvent) {
    this.stop();
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch().distance;
    this.svg.classList.add('dragging');
  }

  private onPointerMove(e: PointerEvent) {
    const previous = this.pointers.get(e.pointerId);
    if (!previous) return;
    const p = this.local(e);

    if (this.pointers.size === 1) {
      this.x += p.x - previous.x;
      this.y += p.y - previous.y;
      this.pointers.set(e.pointerId, p);
      this.update();
      return;
    }

    const before = this.currentPinch();
    this.pointers.set(e.pointerId, p);
    const after = this.currentPinch();
    // Pan with the midpoint, zoom with the finger distance.
    this.x += after.cx - before.cx;
    this.y += after.cy - before.cy;
    if (this.pinchDistance > 0) {
      this.zoomAt(after.cx, after.cy, after.distance / this.pinchDistance);
      this.pinchDistance = after.distance;
    } else {
      this.update();
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch().distance;
    if (this.pointers.size === 0) this.svg.classList.remove('dragging');
  }

  private currentPinch() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private local(e: MouseEvent) {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Scene point p at (x + k·p.x, y + k·p.y) on screen: the viewBox starts at −(x, y)/k, size view/k. */
  private apply() {
    let { width, height } = this;
    if (!(width > 0 && height > 0)) ({ width, height } = this.svg.getBoundingClientRect());
    if (!(width > 0 && height > 0)) return;
    const k = this.k;
    this.svg.setAttribute('viewBox', `${-this.x / k} ${-this.y / k} ${width / k} ${height / k}`);
  }
}
