/**
 * PDF export ("Uložit PDF"): the tree exactly as drawn (render.ts), as a vector poster titled with
 * the family name (else "Rodokmen"), saved straight away as "Rodokmen <family name>.pdf". Page
 * geometry and names: poster.ts.
 *
 * The drawing's SVG is converted by svg2pdf.js into jsPDF drawing commands, with Noto Sans
 * embedded (fonts/noto-sans-400/700.ttf: the bundled WOFF2 subsets merged into TrueType by
 * scripts/fonts_to_ttf.py, as jsPDF needs it), so names keep the widths they were fitted with.
 * Loaded only when the button is used (main.ts imports this module dynamically).
 */
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import type { Layout } from './layout.ts';
import { MARGIN, TITLE_SIZE, pdfFileName, posterPage, posterTitle } from './poster.ts';
import { pageTitle } from './model.ts';
import { renderScene, type RenderOptions } from './render.ts';
import regularUrl from './fonts/noto-sans-400.ttf?url';
import boldUrl from './fonts/noto-sans-700.ttf?url';

/** Name the fonts are registered under in jsPDF: the first family of `FONT.family`. */
const FAMILY = 'Noto Sans';

/** The poster as a PDF document (vector), for `layout` drawn with `ro`, titled with `familyName`. */
export async function posterPdf(layout: Layout, ro: RenderOptions, familyName: string | null): Promise<jsPDF> {
  const page = posterPage(layout.bounds);
  const doc = new jsPDF({
    unit: 'mm',
    format: [page.width, page.height],
    orientation: page.width > page.height ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({ title: pageTitle(familyName), creator: 'Rodokmen' });
  const [regular, bold] = await Promise.all([fontData(regularUrl), fontData(boldUrl)]);
  doc.addFileToVFS('NotoSans-Regular.ttf', regular);
  doc.addFont('NotoSans-Regular.ttf', FAMILY, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', bold);
  doc.addFont('NotoSans-Bold.ttf', FAMILY, 'bold');

  doc.setFont(FAMILY, 'bold');
  doc.setFontSize(TITLE_SIZE);
  doc.setTextColor('#1f1f1f');
  doc.text(posterTitle(familyName), MARGIN, MARGIN, { baseline: 'top' });

  // svg2pdf reads computed styles, so the SVG is in the document while it is converted.
  const b = layout.bounds;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
  holder.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}">` +
    `${renderScene(layout, { ...ro, overlapping: undefined, centralBaseline: centralBaseline(ro) })}</svg>`;
  document.body.append(holder);
  try {
    await doc.svg(holder.firstElementChild!, { x: page.x, y: page.y, width: page.treeWidth, height: page.treeHeight });
  } finally {
    holder.remove();
  }
  return doc;
}

/** Builds the poster and saves it (`pdfFileName`). */
export async function downloadPdf(layout: Layout, ro: RenderOptions, familyName: string | null): Promise<void> {
  (await posterPdf(layout, ro, familyName)).save(pdfFileName(familyName));
}

/**
 * Where the browser puts the central baseline, as a fraction of the font size above the
 * alphabetic one: the middle of the font's ascent and descent (what `dominant-baseline="central"`
 * does on screen). svg2pdf.js maps "central" to jsPDF's "middle", which sits higher, so the PDF
 * gets alphabetic baselines shifted by this instead.
 */
function centralBaseline(ro: RenderOptions): number {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const size = 100;
  ctx.font = `${ro.boldWeight ?? 700} ${size}px ${ro.fontFamily}`;
  const m = ctx.measureText('Hg');
  return (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 / size;
}

/** A font file as base64 (what jsPDF's virtual file system takes). */
async function fontData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`písmo ${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
