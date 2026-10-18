/**
 * The person card: a short tap or click on a person in the tree shows their details
 * (details.ts). On larger screens it floats next to the person, on phones it is a panel at the
 * bottom of the screen (style.css). It closes only with its × button (or Escape); panning,
 * zooming and taps elsewhere keep it open (user, 2026-10-17), a tap on another person switches
 * it; on larger screens it moves with its person (`follow`). A person found by the search box
 * opens the same way (`show`).
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
/** Spacing of the sample points along the highlighted lines that the card should not hide (px). */
const LINE_POINT = 10;
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
  /** Where the floating card was placed relative to its person's cell (stage px; not on phones). */
  private anchor: { cell: DOMRect; x: number; y: number } | null = null;
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
    // iOS Safari zooms the page on a pinch even with touch-action set (style.css): stop it here.
    this.element.addEventListener('gesturestart', (e) => e.preventDefault());

    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    svg.addEventListener('pointerup', (e) => this.onUp(e));
    svg.addEventListener('pointercancel', (e) => this.onCancel(e));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.shown !== null) {
        e.preventDefault();
        this.close();
      }
    });
  }

  /** Whether the card is open. */
  get isOpen(): boolean {
    return this.shown !== null;
  }

  /**
   * Opens the card of person `id` as a tap on them would (a found person, searchbox.ts): their
   * cell in the scene, a partner's inside the blood relative's box. False if not drawn.
   */
  show(id: number): boolean {
    const cell = this.svg.querySelector(`#scene [data-person="${id}"]`);
    if (!cell) return false;
    this.open(id, cell);
    return true;
  }

  /**
   * After a redraw (an edit, a panel change): the open card shows its person's current details
   * and highlight where it is, or closes if that person is gone.
   */
  refresh() {
    if (this.shown === null) return;
    const cell = this.svg.querySelector(`#scene [data-person="${this.shown}"]`);
    if (cell) this.open(this.shown, cell, false);
    else this.close();
  }

  /**
   * The view moved (PanZoom): the floating card moves with its person, keeping its side and gap
   * (beside the person: the same distance from its edge; along it: scaled with the zoom). It may
   * leave the visible area with the person. Phones keep the bottom panel.
   */
  follow() {
    if (this.shown === null || !this.anchor || window.matchMedia(PHONE).matches) return;
    const cell = this.svg.querySelector(`#scene [data-person="${this.shown}"]`);
    if (!cell) return;
    const stage = this.stage.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    const now = new DOMRect(r.left - stage.left, r.top - stage.top, r.width, r.height);
    const { cell: was, x, y } = this.anchor;
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const along = (pos: number, size: number, wasStart: number, wasEnd: number, start: number, end: number) =>
      pos >= wasEnd ? end + (pos - wasEnd)
      : pos + size <= wasStart ? start - (wasStart - pos)
      : start + ((pos - wasStart) * (end - start)) / Math.max(wasEnd - wasStart, 1e-6);
    const style = this.element.style;
    style.left = `${Math.round(along(x, w, was.left, was.right, now.left, now.right))}px`;
    style.top = `${Math.round(along(y, h, was.top, was.bottom, now.top, now.bottom))}px`;
  }

  /** The press in progress is not a tap (a long press opened the edit menu instead). */
  cancelTap() {
    this.press = null;
  }

  close() {
    if (this.shown === null) return;
    this.shown = null;
    this.highlight(null);
    const hadFocus = this.element.contains(document.activeElement);
    this.element.hidden = true;
    if (hadFocus) (document.activeElement as HTMLElement | null)?.blur();
  }

  private onDown(e: PointerEvent) {
    this.pointers.add(e.pointerId);
    // Only a plain left press (or touch/pen) with a single pointer can become a tap.
    if (this.pointers.size > 1 || (e.pointerType === 'mouse' && e.button !== 0)) {
      this.press = null;
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
    }
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (!p.tap || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAP_SLOP) return;
    const cell = document.elementFromPoint(p.x, p.y)?.closest('[data-person]');
    if (!cell || !this.svg.contains(cell)) return;
    this.open(Number(cell.getAttribute('data-person')), cell);
  }

  /**
   * Highlights the line from the box with blood relative `boxId` back to the root (the rest of
   * the tree fades, style.css); null removes it. A partner's box is its blood relative's.
   */
  private highlight(boxId: number | null) {
    const scene = this.svg.querySelector('#scene');
    const file = this.data();
    if (!scene) return;
    for (const el of scene.querySelectorAll('.on-path')) el.classList.remove('on-path');
    scene.classList.toggle('highlighting', boxId !== null && file !== null);
    if (boxId === null || !file) return;
    const byId = new Map(file.people.map((p) => [p.id, p]));
    const path = new Set<string>();
    for (let id: number | null = boxId; id !== null && !path.has(String(id)); id = byId.get(id)?.parentBlood ?? null) {
      path.add(String(id));
    }
    for (const el of scene.querySelectorAll<SVGElement>('[data-box], [data-child]')) {
      if (path.has(el.dataset.box ?? el.dataset.child ?? '')) el.classList.add('on-path');
    }
  }

  private onCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.press = null;
  }

  private open(id: number, cell: Element, place = true) {
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
    if (place) this.element.scrollTop = 0;
    const box = cell.closest('[data-box]')?.getAttribute('data-box');
    this.highlight(box ? Number(box) : null);
    if (place) this.place(cell.getBoundingClientRect());
    // Screen readers announce the dialog; a section has no keyboard to pop up on phones.
    if (!wasOpen) this.element.focus({ preventScroll: true });
  }

  /**
   * Floats the card beside `target` (screen rectangle of the tapped cell), inside the stage, at
   * the candidate position that hides least of the person and then of their highlighted line to
   * the root (boxes and lines); ties go to the earlier candidate (right, left, below, above).
   * On phones CSS docks it to the bottom instead.
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
    // Beside the person: centred on it, or flush with its top or bottom (left/right) edge.
    const right = t.right + GAP;
    const left = t.left - GAP - w;
    const below = t.bottom + GAP;
    const above = t.top - GAP - h;
    const candidates = [
      { x: right, y: midY }, { x: left, y: midY }, { x: midX, y: below }, { x: midX, y: above },
      { x: right, y: t.top }, { x: right, y: t.bottom - h }, { x: left, y: t.top }, { x: left, y: t.bottom - h },
      { x: t.left, y: below }, { x: t.right - w, y: below }, { x: t.left, y: above }, { x: t.right - w, y: above },
    ];
    const { boxes, points } = this.pathShapes(stage);
    const overlap = (x: number, y: number, r: { left: number; top: number; right: number; bottom: number }) =>
      Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top));
    const scored = candidates.map(({ x, y }) => {
      const cx = clamp(x, maxX);
      const cy = clamp(y, maxY);
      const hiddenPath =
        boxes.reduce((sum, r) => sum + overlap(cx, cy, r), 0) +
        points.filter(([px, py]) => px >= cx && px <= cx + w && py >= cy && py <= cy + h).length * LINE_POINT ** 2;
      return { x: cx, y: cy, cost: overlap(cx, cy, t) * 1000 + hiddenPath };
    });
    const best = scored.reduce((a, b) => (b.cost < a.cost ? b : a));
    style.left = `${Math.round(best.x)}px`;
    style.top = `${Math.round(best.y)}px`;
    this.anchor = { cell: new DOMRect(t.left, t.top, t.right - t.left, t.bottom - t.top), x: best.x, y: best.y };
  }

  /**
   * The highlighted line to the root in stage coordinates: its boxes as rectangles, its lines as
   * points every `LINE_POINT` px.
   */
  private pathShapes(stage: DOMRect) {
    type Box = { left: number; top: number; right: number; bottom: number };
    const boxes: Box[] = [];
    const points: [number, number][] = [];
    for (const el of this.svg.querySelectorAll<SVGGraphicsElement>('#scene .on-path')) {
      if (el instanceof SVGPathElement) {
        const m = el.getScreenCTM();
        if (!m) continue;
        const length = el.getTotalLength();
        const n = Math.min(400, Math.max(2, Math.ceil((length * Math.hypot(m.a, m.b)) / LINE_POINT)));
        for (let i = 0; i <= n; i++) {
          const p = el.getPointAtLength((length * i) / n).matrixTransform(m);
          points.push([p.x - stage.left, p.y - stage.top]);
        }
      } else {
        const r = el.getBoundingClientRect();
        boxes.push({ left: r.left - stage.left, top: r.top - stage.top, right: r.right - stage.left, bottom: r.bottom - stage.top });
      }
    }
    return { boxes, points };
  }
}
