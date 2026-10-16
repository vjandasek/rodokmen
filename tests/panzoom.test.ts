import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_FIT_FACTOR, constrainView, fitAvoiding, scaleLimits } from '../src/panzoom.ts';

const bounds = { minX: -1000, minY: -500, maxX: 1000, maxY: 500 };
const W = 800;
const H = 600;

/** Scene point in the middle of the view. */
function centre(v: { x: number; y: number; k: number }) {
  return { x: (W / 2 - v.x) / v.k, y: (H / 2 - v.y) / v.k };
}

describe('view limits', () => {
  it('zoom range is relative to the fit zoom', () => {
    expect(scaleLimits(0.2)).toEqual({ min: 0.2 * MIN_FIT_FACTOR, max: MAX_SCALE });
    expect(scaleLimits(10).max).toBe(20);
  });

  it('a view inside the tree is unchanged', () => {
    const v = { x: 300, y: 250, k: 0.5 }; // middle at scene (200, 100)
    expect(constrainView(v, W, H, bounds, { min: 0.1, max: 6 })).toEqual(v);
  });

  it('clamps the zoom and keeps the middle point', () => {
    const v = { x: W / 2, y: H / 2, k: 0.01 };
    const c = constrainView(v, W, H, bounds, { min: 0.1, max: 6 });
    expect(c.k).toBe(0.1);
    expect(centre(c).x).toBeCloseTo(0);
    expect(centre(c).y).toBeCloseTo(0);
  });

  it('pulls a view dragged far away back to the edge of the tree', () => {
    // Middle of the view at scene (5000, 0): pulled back to the right end of the ellipse.
    const k = 1;
    const v = { x: W / 2 - 5000 * k, y: H / 2, k };
    const c = centre(constrainView(v, W, H, bounds, { min: 0.1, max: 6 }));
    expect(c.x).toBeCloseTo(1000);
    expect(c.y).toBeCloseTo(0);
    // Diagonally: onto the inscribed ellipse, not the empty corner of the rectangle.
    const d = centre(constrainView({ x: W / 2 - 3000, y: H / 2 - 3000, k }, W, H, bounds, { min: 0.1, max: 6 }));
    expect((d.x / 1000) ** 2 + (d.y / 500) ** 2).toBeCloseTo(1);
  });
});

describe('fit around the buttons', () => {
  const square = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  const plain = fitAvoiding(square, 1000, 800, 0.04, null);

  it('a group in the empty corner changes nothing', () => {
    // The tree is round: the bottom-right corner of its rectangle is empty.
    const corner = { left: 860, top: 700, right: 990, bottom: 790 };
    expect(fitAvoiding(square, 1000, 800, 0.04, corner)).toEqual(plain);
  });

  it('a group reaching into the tree shifts it left, keeping the zoom where there is room', () => {
    const wide = fitAvoiding(square, 1400, 800, 0.04, null);
    const group = { left: 1000, top: 300, right: 1390, bottom: 790 };
    const v = fitAvoiding(square, 1400, 800, 0.04, group);
    expect(v.k).toBeCloseTo(wide.k);
    expect(v.x).toBeLessThan(wide.x);
    expect(v.y).toBeCloseTo(wide.y);
    // Right edge of the tree just clear of the group (8 px gap).
    expect(v.x + 500 * v.k).toBeLessThanOrEqual(1000 - 8 + 0.01);
    expect(v.x + 500 * v.k).toBeGreaterThan(1000 - 8 - 1);
  });

  it('with no room to shift the tree shrinks just enough', () => {
    const group = { left: 700, top: 300, right: 990, bottom: 790 };
    const v = fitAvoiding(square, 1000, 800, 0.04, group);
    expect(v.k).toBeLessThan(plain.k);
    expect(v.x + 500 * v.k).toBeGreaterThan(700 - 8 - 1);
  });
});
