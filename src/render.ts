/** Builds the tree drawing as SVG markup. Pure: no DOM access, so it also runs in Node. */
import type { Person, TreeNode } from './model.ts';
import type { Layout, PlacedNode } from './layout.ts';
import { pathData, treeBranches } from './branches.ts';

export type Measure = (text: string, fontSize: number, weight: number, italic: boolean) => number;

export interface RenderOptions {
  measure: Measure;
  fontFamily: string;
  /** Boxes outlined in red (they overlap another box; developer mode only). */
  overlapping?: ReadonlySet<PlacedNode>;
  /** Branch line widths in scene units: a twig to one person, the thickest root line. */
  minLineWidth?: number;
  maxLineWidth?: number;
  /** Font weights of blood relatives (default 700) and partners (default 400). */
  boldWeight?: number;
  normalWeight?: number;
  /** Name size as a multiple of the base fit (`NAME_SCALE` when omitted; see `cellText`). */
  nameScale?: number;
  /**
   * For outputs that place `dominant-baseline="central"` differently from browsers (the PDF
   * export): names are drawn on their alphabetic baseline instead, this many font sizes below
   * the line they are centred on. Omitted: `dominant-baseline="central"` (screen).
   */
  centralBaseline?: number;
}

/** Colour of the branches (warm bark brown, lighter than the former #6b4a2e). */
const BRANCH_COLOR = '#93704f';

/** Rough text width for environments without a canvas (Node previews). */
export const approximateMeasure: Measure = (text, fontSize, weight) =>
  text.length * fontSize * (weight >= 600 ? 0.58 : 0.53);

export function renderScene(layout: Layout, ro: RenderOptions): string {
  const out: string[] = [];
  const maxLevel = layout.radii.length - 1;

  out.push(`<g class="links" fill="none" stroke="${BRANCH_COLOR}" stroke-linecap="round" stroke-linejoin="round">`);
  out.push(...branchPaths(layout, ro));
  out.push('</g>');

  // Solid backings under the boxes, hidden by them: when the person card fades the rest of the
  // tree (boxes see-through, style.css), lines still don't show through the boxes.
  out.push('<g class="backings" fill="#f6f4ef">');
  for (const p of layout.nodes) {
    out.push(
      `<rect x="${f(p.cx - p.width / 2)}" y="${f(p.cy - p.height / 2)}" width="${f(p.width)}" height="${f(p.height)}" rx="${f(p.cellHeight * 0.18)}"/>`,
    );
  }
  out.push('</g>');

  out.push(`<g class="boxes" font-family="${escapeXml(ro.fontFamily)}">`);
  for (const p of layout.nodes) out.push(renderBox(p, maxLevel, ro));
  out.push('</g>');

  // On top of all boxes, so both outlines of an overlapping pair show; 2.5 px at any zoom.
  if (ro.overlapping && ro.overlapping.size > 0) {
    out.push('<g class="overlaps" fill="none" stroke="#d01b1b" stroke-width="2.5">');
    for (const p of layout.nodes) {
      if (!ro.overlapping.has(p)) continue;
      out.push(
        `<rect x="${f(p.cx - p.width / 2)}" y="${f(p.cy - p.height / 2)}" width="${f(p.width)}" height="${f(p.height)}"` +
          ` rx="${f(p.cellHeight * 0.18)}" vector-effect="non-scaling-stroke"/>`,
      );
    }
    out.push('</g>');
  }

  return out.join('\n');
}

/** Branches (branches.ts), thickest drawn first. */
function branchPaths(layout: Layout, ro: RenderOptions): string[] {
  return treeBranches(layout.nodes, ro)
    .sort((a, b) => b.width - a.width)
    .map((p) => `<path d="${pathData(p, f)}" stroke-width="${f(p.width)}" data-child="${p.child.node.person.id}"/>`);
}

function renderBox(p: PlacedNode, maxLevel: number, ro: RenderOptions): string {
  const W = p.cellWidth;
  const H = p.cellHeight;
  const colors = levelColors(p.level, maxLevel);
  const x0 = p.cx - p.width / 2;
  const y0 = p.cy - p.height / 2;
  const radius = H * 0.18;
  const clipId = `clip-${p.node.person.id}`;
  // The box's group names its blood relative (the person card highlights a branch by it).
  const out: string[] = [`<g data-box="${p.node.person.id}">`];
  out.push(
    `<clipPath id="${clipId}"><rect x="${f(x0)}" y="${f(y0)}" width="${f(p.width)}" height="${f(p.height)}" rx="${f(radius)}"/></clipPath>`,
  );
  out.push(`<g clip-path="url(#${clipId})">`);
  const people: Person[] = [p.node.person, ...p.node.partners];
  const cells = people.map((person, i) => ({
    person,
    x: p.stacked ? x0 : x0 + i * W,
    y: p.stacked ? y0 + i * H : y0,
  }));
  // data-person: hit-testing for the developer-mode context menu (editor.ts); ignored by the PDF.
  for (const c of cells) {
    out.push(
      `<rect data-person="${c.person.id}" x="${f(c.x)}" y="${f(c.y)}" width="${f(W)}" height="${f(H)}" fill="${c.person.living ? colors.fill : colors.deceasedFill}"/>`,
    );
  }
  out.push('</g>');
  cells.slice(1).forEach((c) => {
    const line = p.stacked
      ? `x1="${f(x0)}" y1="${f(c.y)}" x2="${f(x0 + W)}" y2="${f(c.y)}"`
      : `x1="${f(c.x)}" y1="${f(y0)}" x2="${f(c.x)}" y2="${f(y0 + H)}"`;
    out.push(`<line ${line} stroke="${colors.stroke}" stroke-width="${f(Math.max(0.6, H / 55))}"/>`);
  });
  out.push(
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(p.width)}" height="${f(p.height)}" rx="${f(radius)}"` +
      ` fill="none" stroke="${colors.stroke}" stroke-width="${f(Math.max(0.8, H / 44))}"/>`,
  );
  cells.forEach((c, i) => out.push(renderCellText(c.person, c.x + W / 2, c.y + H / 2, W, H, i === 0, ro)));
  out.push('</g>');
  return out.join('');
}

/** Line height as a multiple of the font size. */
const LINE_FACTOR = 1.12;

/**
 * Default name size, as a multiple of the base fit that keeps 10 % of the cell height free above
 * and below the two lines. 1.15 leaves about 4 % (the font's own spacing above and below the
 * letters still shows as a margin); at 1.25 descenders (J, j) touch the cell's edge.
 */
export const NAME_SCALE = 1.15;

function renderCellText(
  person: Person, cx: number, cy: number, W: number, H: number, isBlood: boolean, ro: RenderOptions,
): string {
  const { line1, line2, size, weight } = cellText(person, W, H, isBlood, ro.measure, textStyle(ro));
  const lineHeight = size * LINE_FACTOR;
  const color = person.living ? '#ffffff' : '#111111';
  const style = `font-size="${f(size)}" font-weight="${weight}"`;
  const shift = ro.centralBaseline === undefined ? 0 : ro.centralBaseline * size;
  const baseline = ro.centralBaseline === undefined ? ' dominant-baseline="central"' : '';
  const tspans = line2
    ? `<tspan x="${f(cx)}" y="${f(cy - lineHeight / 2 + shift)}">${escapeXml(line1)}</tspan>` +
      `<tspan x="${f(cx)}" y="${f(cy + lineHeight / 2 + shift)}">${escapeXml(line2)}</tspan>`
    : `<tspan x="${f(cx)}" y="${f(cy + shift)}">${escapeXml(line1)}</tspan>`;
  return `<text text-anchor="middle"${baseline} fill="${color}" ${style}>${tspans}</text>`;
}

interface CellText {
  line1: string;
  line2: string;
  size: number;
  weight: number;
}

type TextOptions = Pick<RenderOptions, 'boldWeight' | 'normalWeight' | 'nameScale'>;

interface TextStyle {
  bold: number;
  normal: number;
  scale: number;
}

function textStyle(t: TextOptions): TextStyle {
  return { bold: t.boldWeight ?? 700, normal: t.normalWeight ?? 400, scale: t.nameScale ?? NAME_SCALE };
}

/**
 * Two lines (first name, surname): the height fit times `scale`, unless the cell's width (minus
 * the side padding) allows less.
 */
function cellText(person: Person, W: number, H: number, isBlood: boolean, measure: Measure, { bold, normal, scale }: TextStyle): CellText {
  // Blood relatives bold, partners regular; both upright (italics are harder to read).
  const weight = isBlood ? bold : normal;
  const line1 = (person.living ? '' : '† ') + person.firstName;
  const line2 = person.lastName ?? '';
  const pad = H * 0.1;
  // Sized for two lines even when there is one, so single names don't get a giant font.
  const byHeight = (scale * (H - 2 * pad)) / (2 * LINE_FACTOR);
  const probe = 10;
  const widest = Math.max(measure(line1, probe, weight, false), line2 ? measure(line2, probe, weight, false) : 0);
  const byWidth = (probe * (W - 2 * pad)) / Math.max(widest, 1);
  return { line1, line2, size: Math.min(byHeight, byWidth), weight };
}

/** Font size of the smallest name in the drawing, in scene units (as `renderScene` draws it). */
export function smallestNameSize(layout: Layout, measure: Measure, t: TextOptions = {}): number {
  let smallest = Infinity;
  for (const p of layout.nodes) {
    [p.node.person, ...p.node.partners].forEach((person, i) => {
      smallest = Math.min(smallest, cellText(person, p.cellWidth, p.cellHeight, i === 0, measure, textStyle(t)).size);
    });
  }
  return smallest;
}

/**
 * Green ramp, dark in the centre, lighter outwards, but never lighter than 34 % so white text
 * keeps a contrast of at least 5:1 (WCAG AA asks 4.5:1; 20 % ≈ 9.8:1, 34 % ≈ 5.0:1).
 * Deceased people get a muted grey-green cell with black text (≥ 9.9:1).
 */
export function levelColors(level: number, maxLevel: number): { fill: string; stroke: string; deceasedFill: string } {
  const t = maxLevel === 0 ? 0 : level / maxLevel;
  const lightness = 20 + t * 14;
  return {
    fill: hslHex(140, 45, lightness),
    stroke: hslHex(140, 40, Math.max(lightness - 12, 10)),
    deceasedFill: hslHex(140, 12, 72 + t * 10),
  };
}

/** An HSL colour (degrees, %, %) as #rrggbb: the PDF export (svg2pdf.js) does not read hsl(). */
function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function f(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function countPeople(root: TreeNode): number {
  let n = 0;
  const visit = (t: TreeNode) => {
    n += 1 + t.partners.length;
    t.children.forEach(visit);
  };
  visit(root);
  return n;
}
