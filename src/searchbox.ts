/**
 * The header search box (index.html `#search`): typing lists matching people (search.ts) under
 * the box; a click, a tap or Enter picks one. ↓/↑ move through the list, Escape closes it, a
 * second Escape clears the text. On phones (normal view) only a magnifier button shows, which
 * expands the box across the top; Escape or × collapses it again (style.css).
 */
import { searchPeople, type SearchHit } from './search.ts';
import type { FamilyFile } from './model.ts';

/** The phone breakpoint of style.css. */
const PHONE = '(max-width: 640px)';

export class SearchBox {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly clear: HTMLButtonElement;
  private readonly opener: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly data: () => FamilyFile | null;
  private readonly pick: (id: number) => void;
  private hits: SearchHit[] = [];
  /** Highlighted row (keyboard), -1 for none. */
  private active = -1;

  /** `data`: the family to search (in developer mode the edited one); `pick`: a person was chosen. */
  constructor(root: HTMLElement, data: () => FamilyFile | null, pick: (id: number) => void) {
    this.root = root;
    this.data = data;
    this.pick = pick;
    this.input = root.querySelector('input')!;
    this.clear = root.querySelector('.search-clear')!;
    this.opener = root.querySelector('.search-open')!;
    this.list = root.querySelector('.search-results')!;

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => {
      if (this.input.value.trim()) this.update();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.clear.addEventListener('click', () => {
      this.input.value = '';
      this.update();
      if (this.expanded) this.collapse();
      else this.input.focus();
    });
    this.opener.addEventListener('click', () => this.expand());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as Element).closest<HTMLElement>('[data-index]');
      if (row) this.choose(Number(row.dataset.index));
    });
    // A press outside the box closes the list (and the expanded box on phones).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.root.contains(e.target as Node)) return;
        this.closeList();
        if (this.expanded) this.collapse();
      },
      true,
    );
  }

  private get expanded(): boolean {
    return this.root.classList.contains('expanded');
  }

  /** Phones: the box across the top, ready for typing. */
  private expand() {
    this.root.classList.add('expanded');
    document.body.classList.add('search-expanded');
    this.opener.setAttribute('aria-expanded', 'true');
    this.input.focus();
    this.update();
  }

  private collapse() {
    this.root.classList.remove('expanded');
    document.body.classList.remove('search-expanded');
    this.opener.setAttribute('aria-expanded', 'false');
    this.closeList();
    this.input.blur();
  }

  /** Results for the current text. */
  private update() {
    const query = this.input.value;
    this.clear.hidden = !query && !this.expanded;
    const file = this.data();
    if (!query.trim() || !file) {
      this.closeList();
      return;
    }
    this.hits = searchPeople(file, query);
    this.active = -1;
    if (this.hits.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'search-empty';
      empty.textContent = 'Nikdo nenalezen';
      this.list.replaceChildren(empty);
    } else {
      this.list.replaceChildren(
        ...this.hits.map((hit, i) => {
          const row = document.createElement('li');
          row.id = `search-hit-${i}`;
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', 'false');
          row.dataset.index = String(i);
          const name = document.createElement('span');
          name.className = 'search-name';
          name.textContent = hit.name;
          row.append(name);
          if (hit.detail) {
            const detail = document.createElement('span');
            detail.className = 'search-detail';
            detail.textContent = hit.detail;
            row.append(detail);
          }
          return row;
        }),
      );
    }
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.removeAttribute('aria-activedescendant');
  }

  private closeList() {
    this.list.hidden = true;
    this.hits = [];
    this.active = -1;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  /** Highlights row `i` (keyboard) and keeps it in sight. */
  private setActive(i: number) {
    this.active = i;
    for (const row of this.list.querySelectorAll('[role="option"]')) {
      const on = row.id === `search-hit-${i}`;
      row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
    if (i >= 0) this.input.setAttribute('aria-activedescendant', `search-hit-${i}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private onKey(e: KeyboardEvent) {
    const open = !this.list.hidden;
    const n = this.hits.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        this.update();
        return;
      }
      if (n === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.setActive(this.active < 0 ? (step > 0 ? 0 : n - 1) : (this.active + step + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) this.update();
      if (this.hits.length > 0) this.choose(Math.max(0, this.active));
    } else if (e.key === 'Escape') {
      // One step per press: the list, then the text, then the expanded box (phones). The person
      // card's own Escape (card.ts) only gets a press nothing here needed.
      if (open) this.closeList();
      else if (this.input.value) {
        this.input.value = '';
        this.update();
      } else if (this.expanded) this.collapse();
      else return;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private choose(i: number) {
    const hit = this.hits[i];
    if (!hit) return;
    this.input.value = hit.name;
    this.closeList();
    // Phones: the box and the keyboard make way for the tree and the card.
    if (this.expanded || window.matchMedia(PHONE).matches) this.collapse();
    else this.input.blur();
    this.clear.hidden = !this.input.value;
    this.pick(hit.id);
  }
}
