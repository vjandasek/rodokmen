import { describe, expect, it } from 'vitest';
import { MARGIN, PAGE_WIDTH, TITLE_BAND, pdfFileName, posterPage, posterTitle } from '../src/poster.ts';
import { familyName, pageTitle } from '../src/model.ts';

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

describe('titles', () => {
  it('page: "Rodokmen", plus the family name once the data names it', () => {
    expect(pageTitle(null)).toBe('Rodokmen');
    expect(pageTitle('Novákovi')).toBe('Rodokmen – Novákovi');
    const file = { version: 2, rootId: 1, people: [] };
    expect(familyName(null)).toBeNull();
    expect(familyName(file)).toBeNull();
    expect(familyName({ ...file, familyName: '  ' })).toBeNull();
    expect(familyName({ ...file, familyName: ' Novákovi ' })).toBe('Novákovi');
  });
  it('poster: just the family name, else "Rodokmen"', () => {
    expect(posterTitle('Novákovi')).toBe('Novákovi');
    expect(posterTitle(null)).toBe('Rodokmen');
  });
  it('PDF file: "Rodokmen <family name>.pdf" without characters Windows forbids', () => {
    expect(pdfFileName('Novákovi')).toBe('Rodokmen Novákovi.pdf');
    expect(pdfFileName(null)).toBe('Rodokmen.pdf');
    expect(pdfFileName('A/B: "C"?')).toBe('Rodokmen A B C.pdf');
  });
});
