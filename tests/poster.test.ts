import { describe, expect, it } from 'vitest';
import { MARGIN, PAGE_WIDTH, TITLE_BAND, posterPage } from '../src/poster.ts';

describe('posterPage', () => {
  it('is PAGE_WIDTH wide, keeps the tree\'s proportions and leaves room for the margins and the title', () => {
    for (const [w, h] of [[2741, 2510], [1000, 3000], [3000, 500]]) {
      const page = posterPage({ minX: -w / 3, minY: -h / 2, maxX: (2 * w) / 3, maxY: h / 2 });
      expect(page.width).toBe(PAGE_WIDTH);
      expect(page.treeWidth / page.treeHeight).toBeCloseTo(w / h, 9);
      expect(page.treeWidth).toBeCloseTo(w * page.scale, 9);
      expect(page.x).toBe(MARGIN);
      expect(page.y).toBe(MARGIN + TITLE_BAND);
      expect(page.x + page.treeWidth).toBeCloseTo(page.width - MARGIN, 9);
      expect(page.y + page.treeHeight).toBeCloseTo(page.height - MARGIN, 9);
    }
  });
});
