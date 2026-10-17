import './style.css';
import { buildTree, walk, type FamilyFile, type TreeNode } from './model.ts';
import { defaultOptions, layoutTree, type Bounds, type Layout } from './layout.ts';
import { countPeople, renderScene, smallestNameSize, type Measure, type RenderOptions } from './render.ts';
import { PanZoom } from './panzoom.ts';
import { FONT, loadFonts } from './fonts.ts';
import { Panel } from './panel.ts';
import { findOverlapping, resizeLayout } from './resize.ts';
import { clearLines } from './clear.ts';
import { separateBoxes } from './separate.ts';
import { FamilyEditor } from './edit.ts';
import { EditorUI } from './editor.ts';
import { saveFamily } from './save.ts';
import { PersonCardUI } from './card.ts';
import { SearchBox } from './searchbox.ts';

const svg = document.querySelector<SVGSVGElement>('#view')!;
const scene = svg.querySelector<SVGGElement>('#scene')!;
const stats = document.querySelector<HTMLElement>('#stats')!;
const message = document.querySelector<HTMLElement>('#message')!;
const panelElement = document.querySelector<HTMLElement>('#panel')!;
const panelToggle = document.querySelector<HTMLButtonElement>('#panel-toggle')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const pdfButton = document.querySelector<HTMLButtonElement>('#pdf')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-data')!;

/**
 * Developer mode (`?dev` in the address, read once at load): parameter panel, stats line and
 * overlap outlines. The normal view shows just the tree, drawn with the panel's defaults
 * (the panel exists but stays hidden).
 */
const DEV = new URLSearchParams(location.search).has('dev');

const panZoom = new PanZoom(svg);
panZoom.setObstacle(document.querySelector<HTMLElement>('#controls')!);
const panel = new Panel(panelElement, scheduleRender, () => {
  // "Výchozí": the layout behind the lock is computed afresh with the standard sizes.
  solved = null;
  scheduleRender();
});

// Exported settings name the sizes the locked layout was computed with (the panel can't know them).
panel.lockedSizes = () => {
  if (!panel.locked || !solved) return null;
  const { cellWidth, cellHeight, levelScale } = solved.layout.options;
  return { cellWidth, cellHeight, levelScale };
};

const measureContext = document.createElement('canvas').getContext('2d')!;

/** Canvas text measurement in the given family (the weight comes from the renderer). */
function measureIn(family: string): Measure {
  return (text, fontSize, weight, italic) => {
    measureContext.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${family}`;
    return measureContext.measureText(text).width;
  };
}

/** Names are measured in the bundled font. */
const measure = measureIn(FONT.family);

let tree: TreeNode | null = null;
/** Developer mode: the editable data (editor.ts, edit.ts) and the name of the file it came from. */
let editor: FamilyEditor | null = null;
/** The loaded data (normal view); the person card reads `editor.file` instead when editing. */
let family: FamilyFile | null = null;
let fileName = 'family.json';
/** Deepest generation, for the panel's per-generation scales (reset only when it changes). */
let maxLevel = -1;
let bounds: Bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
/** What is on screen: the drawn layout and how it was drawn (the PDF export draws the same). */
let drawing: { layout: Layout; ro: RenderOptions } | null = null;
/** The last computed layout and the panel options it was computed from (JSON). */
let solved: { layout: Layout; key: string } | null = null;

/** What the stats line shows about the current drawing (layout + render time in `ms`). */
interface Stats {
  people: number;
  generations: number;
  extent: number;
  /** Smallest name font size in scene units. */
  smallestName: number;
  /** Total box area / area of the bounding rectangle. */
  coverage: number;
  /** Pairs of overlapping boxes (only a locked layout with grown boxes has any). */
  overlaps: number;
  ms: number;
}

let current: Stats | null = null;

/**
 * Draws the current panel state. A relayout happens only when there is no layout yet or the
 * layout options changed while unlocked; a locked layout is resized in place (resize.ts).
 * A locked layout computed from scratch (at the start and after "Výchozí") uses the standard
 * sizes of `defaultOptions`; the panel's sizes (by default the display scales) then only
 * enlarge its boxes in place.
 */
function render(fit: boolean) {
  if (!tree) return;
  const t0 = performance.now();
  const options = panel.options();
  const key = JSON.stringify(options);
  if (!solved || (!panel.locked && solved.key !== key)) {
    const base = panel.locked
      ? { ...options, cellWidth: defaultOptions.cellWidth, cellHeight: defaultOptions.cellHeight, levelScale: defaultOptions.levelScale }
      : options;
    try {
      solved = { layout: layoutTree(tree, base), key: JSON.stringify(base) };
    } catch (e) {
      solved = null;
      current = null;
      showMessage(`Strom se nepodařilo rozmístit (${(e as Error).message}).`);
      return;
    }
  }
  message.hidden = true;
  // Appearance ("Vzhled", dev mode) is render-only: it is not part of the layout key above.
  const look = panel.appearance();
  const drawn = panel.locked ? resizeLayout(solved.layout, { ...solved.layout.options, ...options }) : solved.layout;
  // Boxes enlarged by the lock: overlapping ones are pushed apart, then boxes a line passes
  // behind turn aside, both where there is room.
  const layout = clearLines(separateBoxes(drawn), look);
  // Overlaps are a developer aid: outlined and counted only with ?dev.
  const overlaps = DEV ? findOverlapping(layout) : null;
  const ro: RenderOptions = {
    measure,
    fontFamily: FONT.family,
    boldWeight: FONT.bold,
    normalWeight: FONT.normal,
    minLineWidth: look.minLineWidth,
    maxLineWidth: look.maxLineWidth,
  };
  scene.innerHTML = renderScene(layout, { ...ro, overlapping: overlaps?.boxes });
  // An open person card keeps its person and highlight in the new drawing.
  card.refresh();
  drawing = { layout, ro };
  const ms = performance.now() - t0;
  bounds = layout.bounds;
  panZoom.setBounds(bounds);
  if (DEV) {
    current = {
      people: countPeople(tree),
      generations: layout.radii.length,
      extent: layout.extent,
      smallestName: smallestNameSize(layout, measure, { boldWeight: FONT.bold, normalWeight: FONT.normal }),
      coverage: coverage(layout),
      overlaps: overlaps!.pairs,
      ms,
    };
    showStats();
  }
  if (fit) panZoom.fit(bounds);
}

/** A message over the drawing area the user must see (shown in both modes). */
function showMessage(text: string) {
  message.textContent = text;
  message.hidden = false;
}

/** Share of the bounding rectangle covered by boxes. */
function coverage(layout: Layout): number {
  const b = layout.bounds;
  const boxes = layout.nodes.reduce((sum, p) => sum + p.width * p.height, 0);
  return boxes / ((b.maxX - b.minX) * (b.maxY - b.minY));
}

/** Number with a decimal comma, as Czech writes it. */
function czech(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Readability depends on the view size: the smallest name's height when the whole tree is fitted. */
function showStats() {
  if (!current) return;
  const s = current;
  const namePx = s.smallestName * panZoom.fitScale(bounds);
  stats.textContent =
    `${s.people} osob · ${s.generations} generací · poloměr ${Math.round(s.extent)} · ` +
    `nejmenší písmo ${czech(namePx, 1)} px · pokrytí ${Math.round(100 * s.coverage)} % · `;
  if (s.overlaps > 0) {
    const warning = document.createElement('span');
    warning.className = 'warning';
    warning.textContent = `překryvy: ${s.overlaps}`;
    warning.title = 'Počet dvojic boxů, které se překrývají (červený obrys)';
    stats.append(warning, ' · ');
  }
  stats.append(`${s.ms.toFixed(0)} ms`);
}

let frame = 0;

/** Parameter changes keep the current view; a slider drag redraws (relayouts) at most once per frame. */
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render(false);
  });
}

/** Name sizes are measured, so the tree's font must be ready before the first layout. */
async function fontsReady() {
  try {
    await loadFonts();
  } catch (e) {
    console.warn('Písmo se nepodařilo načíst, použije se náhradní.', e);
  }
}

/** The tree from the data; the panel learns the number of generations. */
function setTree(file: FamilyFile) {
  tree = buildTree(file);
  const deepest = Math.max(...[...walk(tree)].map((n) => n.level));
  if (deepest !== maxLevel) panel.setGenerations(deepest);
  maxLevel = deepest;
}

/**
 * The family data. On the Vite dev server (both modes), the newest data/family*.json (saved
 * edits, via the dev server's /api/family-latest); otherwise, or when that fails, data/family.json.
 */
async function fetchFamily(): Promise<FamilyFile> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('./api/family-latest');
      if (response.ok) {
        fileName = response.headers.get('X-Family-File') ?? fileName;
        return (await response.json()) as FamilyFile;
      }
    } catch {
      // Fall back to data/family.json below.
    }
  }
  const response = await fetch('./data/family.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as FamilyFile;
}

async function load() {
  try {
    const [file] = await Promise.all([fetchFamily(), fontsReady()]);
    family = file;
    setTree(file);
    if (DEV) startEditing(file);
    message.hidden = true;
    render(true);
    if (!DEV) showHint();
  } catch (e) {
    showMessage(
      `Nepodařilo se načíst data rodokmenu (${(e as Error).message}).`,
    );
  }
}

/** Seconds the hint stays before it fades out by itself. */
const HINT_SECONDS = 9;

/** Shows the hint once per page load; it fades after a while or at the first interaction. */
function showHint() {
  hint.hidden = false;
  let timer = 0;
  const events = ['pointerdown', 'wheel', 'keydown'] as const;
  const dismiss = () => {
    clearTimeout(timer);
    for (const type of events) window.removeEventListener(type, dismiss, true);
    hint.classList.add('fading');
    hint.addEventListener('transitionend', () => (hint.hidden = true), { once: true });
  };
  timer = window.setTimeout(dismiss, HINT_SECONDS * 1000);
  for (const type of events) window.addEventListener(type, dismiss, { capture: true, passive: true });
}

/** Button and arrow-key moves: a quarter of the view. */
const PAN_STEP = 0.25;
const ZOOM_STEP = 1.5;

const actions: Record<string, () => void> = {
  'zoom-in': () => panZoom.zoomBy(ZOOM_STEP),
  'zoom-out': () => panZoom.zoomBy(1 / ZOOM_STEP),
  fit: () => panZoom.fit(bounds, true),
  'pan-up': () => panZoom.panBy(0, -PAN_STEP),
  'pan-down': () => panZoom.panBy(0, PAN_STEP),
  'pan-left': () => panZoom.panBy(-PAN_STEP, 0),
  'pan-right': () => panZoom.panBy(PAN_STEP, 0),
};

const keys: Record<string, string> = {
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '0': 'fit',
  ArrowUp: 'pan-up',
  ArrowDown: 'pan-down',
  ArrowLeft: 'pan-left',
  ArrowRight: 'pan-right',
};

if (DEV) {
  document.body.classList.add('dev');
  // index.html hides these; developer mode starts with the panel open.
  stats.hidden = false;
  panelToggle.hidden = false;
  panelElement.hidden = false;
  panelToggle.setAttribute('aria-expanded', 'true');
}
panelToggle.addEventListener('click', () => {
  // The view keeps its centre while it resizes (PanZoom watches its size).
  panelElement.hidden = !panelElement.hidden;
  panelToggle.setAttribute('aria-expanded', String(!panelElement.hidden));
});
if (DEV) new ResizeObserver(showStats).observe(svg);
for (const [id, action] of Object.entries(actions)) {
  document.getElementById(id)!.addEventListener('click', action);
}

/** A tap on a person shows their card (both modes). */
const card = new PersonCardUI(svg, () => editor?.file ?? family);
panZoom.onView = () => card.follow();

/** Space the phone's bottom card panel takes from the view (style.css: max-height 55%). */
const PHONE_CARD_SHARE = 0.55;
/** Space the floating title and search take at the top on phones (px). */
const PHONE_TOP = 64;

/**
 * A person picked in the search box: the view glides to their box (a partner's is inside the
 * blood relative's), then their card opens with the line to the root, as after a tap. On phones
 * the box lands above the bottom card panel.
 */
new SearchBox(document.querySelector<HTMLElement>('#search')!, () => editor?.file ?? family, (id) => {
  card.close();
  const cell = svg.querySelector(`#scene [data-person="${id}"]`);
  if (!cell) return;
  const box = cell.closest('[data-box]') ?? cell;
  const phone = window.matchMedia('(max-width: 640px)').matches;
  const height = svg.getBoundingClientRect().height;
  const insets = phone ? { top: PHONE_TOP, bottom: height * PHONE_CARD_SHARE } : {};
  panZoom.focusOn(panZoom.toScene(box.getBoundingClientRect()), insets).then((arrived) => {
    if (arrived) card.show(id);
  });
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  // Typing in the panel's fields (and browser shortcuts like Ctrl+plus) keep their meaning.
  if (target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const action = actions[keys[e.key] ?? ''];
  if (!action) return;
  e.preventDefault();
  action();
});

/**
 * "Uložit PDF": the tree as on screen (whole, not just the view) saved as a poster PDF. The PDF
 * code and its fonts load only now (pdf.ts), which takes a moment: the button says so meanwhile.
 */
pdfButton.addEventListener('click', async () => {
  if (!drawing || pdfButton.disabled) return;
  const label = pdfButton.textContent;
  pdfButton.disabled = true;
  pdfButton.textContent = 'Připravuji PDF…';
  try {
    const { downloadPdf } = await import('./pdf.ts');
    await downloadPdf(drawing.layout, drawing.ro);
  } catch (e) {
    showMessage(`PDF se nepodařilo vytvořit (${(e as Error).message}).`);
  } finally {
    pdfButton.disabled = false;
    pdfButton.textContent = label;
  }
});

/** Developer mode: editing through the tree's context menu, Ctrl+Z, "Uložit data". */
function startEditing(file: FamilyFile) {
  const ed = new FamilyEditor(file);
  editor = ed;
  const ui = new EditorUI(ed, svg, () => {
    // Every edit: a fresh layout of the changed tree, the view stays where it is.
    setTree(ed.file);
    solved = null;
    render(false);
    showSaveState();
  });
  ui.onLongPress = () => card.cancelTap();
  saveButton.hidden = false;
  showSaveState();
}

/** The save button shows unsaved changes and names the loaded file. */
function showSaveState() {
  if (!editor) return;
  const dirty = editor.dirty;
  saveButton.textContent = dirty ? 'Uložit data •' : 'Uložit data';
  saveButton.title = `${dirty ? 'Neuložené změny' : 'Bez změn'} (načteno ze souboru ${fileName})`;
}

saveButton.addEventListener('click', async () => {
  if (!editor || saveButton.disabled) return;
  saveButton.disabled = true;
  try {
    await saveFamily(editor);
  } catch (e) {
    showMessage(`Data se nepodařilo uložit (${(e as Error).message}).`);
  } finally {
    saveButton.disabled = false;
    showSaveState();
  }
});

// Leaving the page with unsaved edits asks first.
window.addEventListener('beforeunload', (e) => {
  if (editor?.dirty) e.preventDefault();
});

if (DEV) {
  // A right press on the tree must not start a pan (it opens the editing menu): it never reaches PanZoom.
  svg.parentElement!.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) e.stopPropagation();
    },
    true,
  );
}

load();
