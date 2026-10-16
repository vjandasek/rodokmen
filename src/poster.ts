/**
 * The poster page of the PDF export (pdf.ts): the tree's own shape, `PAGE_WIDTH` mm wide — the
 * short side of A1, so it prints on an A1 sheet cut to size (the smallest names then about 11 pt),
 * and a copy shop can scale it to any other size without losing sharpness (it is vector).
 * Separate from pdf.ts so it can be tested without the PDF libraries (they need a browser).
 */
import type { Bounds } from './layout.ts';

/** Page width in mm (the short side of A1). */
export const PAGE_WIDTH = 594;
/** Margin around everything, in mm. */
export const MARGIN = 15;
/** Title font size in pt and the band it takes above the tree, in mm. */
export const TITLE_SIZE = 48;
export const TITLE_BAND = 25;

export interface PosterPage {
  /** Page size in mm. */
  width: number;
  height: number;
  /** Where the tree goes (mm) and its scale (mm per scene unit). */
  x: number;
  y: number;
  treeWidth: number;
  treeHeight: number;
  scale: number;
}

/** The page for a tree with these bounds: `PAGE_WIDTH` wide, as high as the tree needs. */
export function posterPage(bounds: Bounds): PosterPage {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = (PAGE_WIDTH - 2 * MARGIN) / w;
  const treeHeight = h * scale;
  return {
    width: PAGE_WIDTH,
    height: 2 * MARGIN + TITLE_BAND + treeHeight,
    x: MARGIN,
    y: MARGIN + TITLE_BAND,
    treeWidth: PAGE_WIDTH - 2 * MARGIN,
    treeHeight,
    scale,
  };
}
