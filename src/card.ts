/**
 * The person card: a short tap or click on a person in the tree shows their details
 * (details.ts). On larger screens it floats next to the person, on phones it is a panel at the
 * bottom of the screen (style.css). A drag or pinch is a pan/zoom, not a tap, and closes the
 * card; so do the × button, a tap elsewhere and Escape.
 *
 * PanZoom captures the pointer, so the `click` target is the svg: taps are recognised here from
 * the pointer's own down/move/up events and the person is found under the pointer
 * (`elementFromPoint`; style.css makes the box texts and outlines transparent to it).
 */
import { personCard } from './details.ts';
import type { FamilyFile } from './model.ts';

/** A press that moves less than this (in CSS px) and uses one pointer is a tap. */
const TAP_SLOP = 6;
/** Gap between the card and the tapped person, and the card's margin from the stage edges. */
const GAP = 12;
/** The phone breakpoint of style.css: the card is a bottom panel there. */
const PHONE = '(max-width: 640px)';
/** Rows about relatives (details.ts labels); the card shows them in a section of their own. */
const FAMILY = new Set(['Rodiče', 'Manžel', 'Manželka', 'Partner', 'Partnerka', 'Děti']);

export class PersonCardUI {
  private readonly svg: SVGSVGElement;
  private readonly stage: HTMLElement;
  private readonly data: () => FamilyFile | null;
  private readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly rows: HTMLElement;
  /** Person shown, or null when closed. */
  private shown: number | null = null;
  /** The press in progress on the tree: where it started and whether it is still a tap. */
  private press: { id: number; x: number; y: number; tap: boolean } | null = null;
  /** Pointers down on the tree (a second one makes a pinch). */
  private readonly pointers = new Set<number>();

  /** `data`: the family file the card describes (in developer mode the edited one). */
  constructor(svg: SVGSVGElement, data: () => FamilyFile | null) {
    this.svg = svg;
    this.stage = svg.parentElement!;
    this.data = data;

    this.element = document.createElement('section');
    this.element.className = 'person-card';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', 'person-card-name');
    this.element.tabIndex = -1;
    this.element.hidden = true;
    const head = document.createElement('div');
    head.className = 'person-card-head';
    this.title = document.createElement('h2');
    this.title.id = 'person-card-name';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'person-card-close';
    close.setAttribute('aria-label', 'Zavřít');
    close.title = 'Zavřít (Esc)';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    head.append(this.title, close);
    this.rows = document.createElement('div');
    this.element.append(head, this.rows);
    this.stage.append(this.element);

    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    svg.addEventListener('pointerup', (e) => this.onUp(e));
    svg.addEventListener('pointercancel', (e) => this.onCancel(e));
    // Zooming (wheel, double click) or the dev-mode editing menu: the card would be out of place.
    svg.addEventListener('wheel', () => this.close(), { passive: true });
    svg.addEventListener('dblclick', () => this.close());
    svg.addEventListener('contextmenu', () => this.close());
    // A press anywhere outside the tree and the card (header, buttons, panel) closes it.
    document.addEventListener(
      'pointerdown',
      (e) => {
        const target = e.target as Node;
        if (!this.svg.contains(target) && !this.element.contains(target)) this.close();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.shown !== null) {
        e.preventDefault();
        this.close();
      }
    });
    window.addEventListener('resize', () => this.close());
  }

  /** Whether the card is open. */
  get isOpen(): boolean {
    return this.shown !== null;
  }

  close() {
    if (this.shown === null) return;
    this.shown = null;
    const hadFocus = this.element.contains(document.activeElement);
    this.element.hidden = true;
    if (hadFocus) (document.activeElement as HTMLElement | null)?.blur();
  }

  private onDown(e: PointerEvent) {
    this.pointers.add(e.pointerId);
    // Only a plain left press (or touch/pen) with a single pointer can become a tap.
    if (this.pointers.size > 1 || (e.pointerType === 'mouse' && e.button !== 0)) {
      this.press = null;
      this.close();
      return;
    }
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, tap: true };
  }

  private onMove(e: PointerEvent) {
    const p = this.press;
    if (!p || p.id !== e.pointerId || !p.tap) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAP_SLOP) {
      // A pan has started.
      p.tap = false;
      this.close();
    }
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (!p.tap || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAP_SLOP) return;
    const cell = document.elementFromPoint(p.x, p.y)?.closest('[data-person]');
    if (!cell || !this.svg.contains(cell)) {
      this.close();
      return;
    }
    this.open(Number(cell.getAttribute('data-person')), cell);
  }

  private onCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.press = null;
  }

  private open(id: number, cell: Element) {
    const file = this.data();
    if (!file) return;
    let card;
    try {
      card = personCard(file, id, new Date());
    } catch (e) {
      console.warn(`Kartu osoby ${id} se nepodařilo sestavit.`, e);
      this.close();
      return;
    }
    this.title.textContent = card.name;
    // Own details, then relatives: two lists of label and value with a divider between them.
    const sections = [
      card.rows.filter((r) => !FAMILY.has(r.label)),
      card.rows.filter((r) => FAMILY.has(r.label)),
    ].filter((rows) => rows.length > 0);
    this.rows.replaceChildren(
      ...sections.map((rows) => {
        const list = document.createElement('dl');
        list.append(
          ...rows.flatMap((row) => {
            const dt = document.createElement('dt');
            dt.textContent = row.label;
            const dd = document.createElement('dd');
            dd.textContent = row.value;
            return [dt, dd];
          }),
        );
        return list;
      }),
    );
    this.rows.hidden = card.rows.length === 0;
    const wasOpen = this.shown !== null;
    this.shown = id;
    this.element.hidden = false;
    this.element.scrollTop = 0;
    this.place(cell.getBoundingClientRect());
    // Screen readers announce the dialog; a section has no keyboard to pop up on phones.
    if (!wasOpen) this.element.focus({ preventScroll: true });
  }

  /**
   * Floats the card beside `target` (screen rectangle of the tapped cell), inside the stage:
   * right of it, else left, else below or above, whichever covers it least. On phones CSS
   * docks it to the bottom instead.
   */
  private place(target: DOMRect) {
    const style = this.element.style;
    if (window.matchMedia(PHONE).matches) {
      style.left = style.top = '';
      return;
    }
    const stage = this.stage.getBoundingClientRect();
    // Measured at the top-left corner, so the size is not squeezed by the stage edge.
    style.left = style.top = '0px';
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const t = {
      left: target.left - stage.left,
      right: target.right - stage.left,
      top: target.top - stage.top,
      bottom: target.bottom - stage.top,
    };
    const maxX = Math.max(GAP, stage.width - w - GAP);
    const maxY = Math.max(GAP, stage.height - h - GAP);
    const clamp = (v: number, max: number) => Math.min(max, Math.max(GAP, v));
    const midY = (t.top + t.bottom) / 2 - h / 2;
    const midX = (t.left + t.right) / 2 - w / 2;
    const candidates = [
      { x: t.right + GAP, y: midY },
      { x: t.left - GAP - w, y: midY },
      { x: midX, y: t.bottom + GAP },
      { x: midX, y: t.top - GAP - h },
    ].map(({ x, y }) => {
      const cx = clamp(x, maxX);
      const cy = clamp(y, maxY);
      const ox = Math.max(0, Math.min(cx + w, t.right) - Math.max(cx, t.left));
      const oy = Math.max(0, Math.min(cy + h, t.bottom) - Math.max(cy, t.top));
      return { x: cx, y: cy, covered: ox * oy };
    });
    // The first position (right, left, below, above) that covers the least.
    const best = candidates.reduce((a, b) => (b.covered < a.covered ? b : a));
    style.left = `${Math.round(best.x)}px`;
    style.top = `${Math.round(best.y)}px`;
  }
}
