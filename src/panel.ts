/**
 * Sidebar with the layout parameters (developer mode only, `?dev`; in the normal view it is
 * hidden but still holds the default state the tree is drawn with). Every numeric value is a
 * slider plus a number field; any change calls `onChange`, and `options()` and `locked`
 * return the current values. A setting that differs from its default is highlighted and gets
 * a "↺" button resetting just that setting. "Zamknout rozmístění" keeps the layout while
 * sizes change (see resize.ts) and disables the other layout settings. "Vzhled" (name size, line widths,
 * `appearance()`) only redraws. Nothing is stored: a reload starts from
 * the defaults below. "Kopírovat nastavení" / "Uložit jako soubor" export all values as JSON
 * (`settingsJson()`), so a view can be reported as text instead of a screenshot.
 */
import { defaultOptions, type LayoutOptions } from './layout.ts';
import { DEFAULT_MAX_LINE_WIDTH, DEFAULT_MIN_LINE_WIDTH } from './connectors.ts';
import { NAME_SCALE } from './render.ts';

/**
 * Render-only settings ("Vzhled", developer mode): changing them only redraws, never
 * relayouts, and they work while the layout is locked. `undefined` values mean the
 * renderer's own defaults.
 */
export interface Appearance {
  minLineWidth?: number;
  maxLineWidth?: number;
  /** Name size multiple (render.ts `NAME_SCALE`). */
  nameScale?: number;
}

type NumericKey =
  'cellWidth' | 'cellHeight' | 'ringGap' | 'siblingGap' | 'cousinGap' | 'spread' | 'lean' | 'maxGap' | 'partnerThreshold';
type ChoiceKey = 'partnerMode';
type SettingKey = NumericKey | ChoiceKey;

interface Range {
  min: number;
  max: number;
  step: number;
}

interface Spec extends Range {
  label: string;
  /** Tooltip explaining what the value does. */
  title: string;
  /** Shown in %: the option is the field's value / 100. */
  percent?: boolean;
}

const SPECS: Record<NumericKey, Spec> = {
  cellWidth: { label: 'Šířka buňky', title: 'Šířka buňky jedné osoby při měřítku 1', min: 40, max: 300, step: 1 },
  cellHeight: { label: 'Výška buňky', title: 'Výška buňky jedné osoby při měřítku 1', min: 16, max: 120, step: 1 },
  ringGap: {
    label: 'Mezera mezi generacemi', min: 0, max: 100, step: 1,
    title: 'Nejmenší vzdálenost mezi sousedními kruhy; vedou tudy spojnice',
  },
  siblingGap: {
    label: 'Mezera mezi sourozenci', min: 0, max: 40, step: 1,
    title: 'Nejmenší mezera mezi sousedními dětmi stejného rodiče',
  },
  cousinGap: {
    label: 'Mezera mezi rodinami', min: 0, max: 60, step: 1,
    title: 'Nejmenší mezera mezi sousedními boxy z různých rodin (bratranci, sestřenice)',
  },
  spread: {
    label: 'Rozprostření (%)', min: 0, max: 100, step: 5, percent: true,
    title:
      'Rozprostře rodiny do volného místa vedle nich: boxy se na kruzích posunou tak, aby ' +
      'mezery mezi sousedy byly co nejrovnoměrnější (zda rodič zůstane uprostřed nad dětmi, ' +
      'určuje Naklonění rodin). 0 % = těsné shluky pod rodiči, 100 % = co ' +
      'nejrovnoměrnější mezery.',
  },
  lean: {
    label: 'Naklonění rodin (%)', min: 0, max: 100, step: 5, percent: true,
    title:
      'Jak moc se rodina při rozprostření může naklonit do volného místa. 0 % = rodič zůstává ' +
      'přesně uprostřed nad svými dětmi, jediné dítě je v ose s rodičem (dříve „Vyváženě“). ' +
      '100 % = rodina se může volně naklonit tam, kde je volné místo, rodič nemusí zůstat ' +
      'uprostřed (dříve „Volně“).',
  },
  maxGap: {
    label: 'Největší mezera', min: 10, max: 400, step: 5,
    title:
      'Do jaké velikosti rozprostření rozšiřuje mezery mezi sousedy na kruhu. Větší mezera už ' +
      'čitelnosti nepomůže, jen by boxy rozehnala do prázdna (např. sourozence daleko od sebe).',
  },
  partnerThreshold: {
    label: 'Práh přepnutí', min: 0.5, max: 1, step: 0.01,
    title:
      'Jen pro „Nejmenší úhel“: partneři se přeskupí, jen když druhé uspořádání zabere méně ' +
      'než tento podíl úhlu (1 = vždy menší)',
  },
};

interface ChoiceSpec<T extends string | number> {
  /** Accessible name; the section heading shows it. */
  label: string;
  title: string;
  /** Value and text of each option. */
  choices: [T, string][];
}

const CHOICES: { [K in ChoiceKey]: ChoiceSpec<LayoutOptions[K]> } = {
  partnerMode: {
    label: 'Partneři',
    title:
      'Automaticky: u každého boxu to uspořádání, které sahá nejméně ven (menší strom); ' +
      'úhel šetří jen tam, kde na kruhu dochází místo. ' +
      'Nejmenší úhel: u každého boxu to uspořádání, které na kruhu zabere menší úhel. ' +
      'Vedle sebe / Pod sebou: stejné uspořádání pro všechny boxy.',
    choices: [
      ['auto', 'Automaticky'],
      ['angle', 'Nejmenší úhel'],
      ['side', 'Vedle sebe'],
      ['stacked', 'Pod sebou'],
    ],
  },
};

/**
 * Line widths in scene units, starting at the renderer's defaults (connectors.ts); while a
 * slider is at its default, `appearance()` passes `undefined`, so the renderer decides.
 */
const LINE_SPECS = {
  minLineWidth: {
    label: 'Nejtenčí čára', min: 1, max: 15, step: 0.5, value: DEFAULT_MIN_LINE_WIDTH,
    title: 'Šířka nejtenčích větví (k lidem bez potomků, na okraji stromu)',
  },
  maxLineWidth: {
    label: 'Nejsilnější čára', min: 5, max: 60, step: 0.5, value: DEFAULT_MAX_LINE_WIDTH,
    title: 'Šířka nejsilnějších větví (u středu, nesou nejvíc lidí)',
  },
};

/** Name size in % of the base fit (render.ts `NAME_SCALE`); at 125 % descenders touch the cell's edge. */
const NAME_SPEC = {
  label: 'Velikost jmen (%)', min: 100, max: 125, step: 1, value: Math.round(NAME_SCALE * 100),
  title: 'Velikost jmen v boxech: 100 % nechá nad a pod jménem 10 % výšky buňky, víc zmenší tento okraj (boxy se nemění)',
};

const LEVEL_RANGE: Range = { min: 0.3, max: 3, step: 0.05 };

/*
 * Default state (the normal view, the panel's start and "Výchozí"): the layout is locked. It
 * is computed once with the standard sizes of `defaultOptions` (cell 110×44, generation
 * scales 2 / 1.7 / 1.25 / 1.1 / 1) and the boxes are then enlarged in place, without moving,
 * to `DISPLAY_SCALE` (see main.ts). Boxes may overlap; the user accepts that.
 */
export const DEFAULT_LOCKED = true;
/** Box size multiplier per generation 0, 1, 2, …; the last value repeats for deeper ones. */
export const DISPLAY_SCALE = [2, 1.7, 1.4, 1.2, 1.15, 1.35];

/** Settings that stay enabled while the layout is locked (they only resize the boxes). */
const SIZE_KEYS: NumericKey[] = ['cellWidth', 'cellHeight'];

const LOCKED_NOTE = 'Rozmístění je zamčené; pro změnu ho odemkněte (Rozměry → Zamknout rozmístění).';
const SPREAD_OFF_NOTE = 'Rozprostření je 0 %, takže se nepoužije; pro změnu zvyšte Rozprostření.';

function isChoice(key: SettingKey): key is ChoiceKey {
  return key in CHOICES;
}

/** Number with a decimal comma, as Czech writes it. */
function czech(value: number): string {
  return String(value).replace('.', ',');
}

/** Small button that resets one setting; hidden (but keeping its space) until it differs. */
function resetButton(defaultText: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'reset-one';
  button.textContent = '↺';
  button.title = `Výchozí: ${defaultText}`;
  button.setAttribute('aria-label', `Vrátit na výchozí (${defaultText})`);
  button.addEventListener('click', onClick);
  return button;
}

/** Default (display) size multiplier of a generation; the last entry repeats for deeper ones. */
function defaultScale(level: number): number {
  return DISPLAY_SCALE[Math.min(level, DISPLAY_SCALE.length - 1)];
}

/** A slider and a number field showing the same value, plus a reset button. */
class NumberInput {
  readonly element = document.createElement('div');
  value: number;
  private readonly defaultValue: number;
  private readonly caption = document.createElement('label');
  private readonly slider = document.createElement('input');
  private readonly field = document.createElement('input');
  private readonly reset: HTMLButtonElement;
  private readonly title: string;

  constructor(id: string, label: string, title: string, range: Range, value: number, onInput: () => void) {
    this.value = this.defaultValue = value;
    this.title = title;
    this.element.className = 'control';
    this.element.title = title;
    this.caption.htmlFor = id;
    this.caption.textContent = label;
    this.field.id = id;
    this.field.type = 'number';
    this.slider.type = 'range';
    this.slider.setAttribute('aria-label', label);
    for (const input of [this.field, this.slider]) {
      input.min = String(range.min);
      input.max = String(range.max);
      input.step = String(range.step);
      input.value = String(value);
    }
    this.reset = resetButton(czech(value), () => {
      this.set(this.defaultValue);
      onInput();
    });
    this.element.append(this.caption, this.field, this.reset, this.slider);

    this.slider.addEventListener('input', () => {
      this.value = this.slider.valueAsNumber;
      this.field.value = this.slider.value;
      this.markChanged();
      onInput();
    });
    this.field.addEventListener('input', () => {
      // Empty or unfinished numbers are ignored until they parse; out-of-range ones are clamped.
      const typed = this.field.valueAsNumber;
      if (!Number.isFinite(typed)) return;
      const v = Math.min(range.max, Math.max(range.min, typed));
      if (v === this.value) return;
      this.value = v;
      this.slider.value = String(v);
      this.markChanged();
      onInput();
    });
    // Once editing ends, show the value actually in use.
    this.field.addEventListener('change', () => {
      this.field.value = String(this.value);
    });
  }

  set(value: number) {
    this.value = value;
    this.slider.value = this.field.value = String(value);
    this.markChanged();
  }

  restoreDefault() {
    this.set(this.defaultValue);
  }

  /** Greys the control out; `why` is added to its tooltip. */
  disable(disabled: boolean, why: string | null = null) {
    this.slider.disabled = this.field.disabled = this.reset.disabled = disabled;
    this.element.classList.toggle('disabled', disabled);
    this.element.title = why ? `${this.title}\n\n${why}` : this.title;
  }

  get isChanged(): boolean {
    return this.value !== this.defaultValue;
  }

  private markChanged() {
    this.element.classList.toggle('changed', this.isChanged);
  }
}

/** A drop-down list plus a reset button. */
class ChoiceInput {
  readonly element = document.createElement('div');
  private readonly select = document.createElement('select');
  private readonly reset: HTMLButtonElement;
  private readonly spec: ChoiceSpec<string | number>;
  private readonly defaultValue: string;

  constructor(id: string, spec: ChoiceSpec<string | number>, value: string | number, onInput: () => void) {
    this.spec = spec;
    this.defaultValue = String(value);
    this.element.className = 'control choice';
    this.select.id = id;
    this.select.title = spec.title;
    for (const [v, text] of spec.choices) this.select.add(new Option(text, String(v)));
    this.select.value = this.defaultValue;
    this.select.addEventListener('change', () => {
      this.markChanged();
      onInput();
    });
    this.select.setAttribute('aria-label', spec.label);
    const defaultText = spec.choices.find(([v]) => v === value)![1];
    this.reset = resetButton(defaultText, () => {
      this.set(this.defaultValue);
      onInput();
    });
    this.element.append(this.select, this.reset);
  }

  /** The selected option's value, with its type (a number for numeric options). */
  get value(): string | number {
    return this.spec.choices.find(([v]) => String(v) === this.select.value)![0];
  }

  set(value: string) {
    this.select.value = value;
    this.markChanged();
  }

  restoreDefault() {
    this.set(this.defaultValue);
  }

  /** Greys the control out; `why` is added to its tooltip. */
  disable(disabled: boolean, why: string | null = null) {
    this.select.disabled = this.reset.disabled = disabled;
    this.element.classList.toggle('disabled', disabled);
    // Also on the wrapper: some browsers show no tooltip over a disabled element.
    this.select.title = this.element.title = why ? `${this.spec.title}\n\n${why}` : this.spec.title;
  }

  get isChanged(): boolean {
    return this.select.value !== this.defaultValue;
  }

  private markChanged() {
    this.element.classList.toggle('changed', this.isChanged);
  }
}

/** A checkbox with its text, plus a reset button. */
class CheckInput {
  readonly element = document.createElement('div');
  private readonly box = document.createElement('input');
  private readonly defaultValue: boolean;

  constructor(id: string, label: string, title: string, value: boolean, onInput: () => void) {
    this.defaultValue = value;
    this.element.className = 'control check';
    this.element.title = title;
    this.box.type = 'checkbox';
    this.box.id = id;
    this.box.checked = value;
    this.box.addEventListener('change', () => {
      this.markChanged();
      onInput();
    });
    const caption = document.createElement('label');
    caption.append(this.box, label);
    this.element.append(caption, resetButton(value ? 'zapnuto' : 'vypnuto', () => {
      this.set(this.defaultValue);
      onInput();
    }));
  }

  get value(): boolean {
    return this.box.checked;
  }

  set(value: boolean) {
    this.box.checked = value;
    this.markChanged();
  }

  restoreDefault() {
    this.set(this.defaultValue);
  }

  get isChanged(): boolean {
    return this.box.checked !== this.defaultValue;
  }

  private markChanged() {
    this.element.classList.toggle('changed', this.isChanged);
  }
}

function section(heading: string, ...children: HTMLElement[]): HTMLElement {
  const s = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = heading;
  s.append(h, ...children);
  return s;
}

/** Sizes a locked layout was computed with (main.ts knows them; see `Panel.lockedSizes`). */
export type LockedSizes = Pick<LayoutOptions, 'cellWidth' | 'cellHeight' | 'levelScale'>;

/** Local time as YYYY-MM-DD-HHMM, for export file names. */
function stamp(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export class Panel {
  /** Set by main.ts: the sizes behind the lock (`null` while unlocked or not yet laid out). */
  lockedSizes: () => LockedSizes | null = () => null;
  private readonly numbers = new Map<NumericKey, NumberInput>();
  private readonly choices = new Map<ChoiceKey, ChoiceInput>();
  private readonly lock: CheckInput;
  private readonly minLine: NumberInput;
  private readonly nameSize: NumberInput;
  private readonly maxLine: NumberInput;
  private levels: NumberInput[] = [];
  private readonly levelSection: HTMLElement;
  private readonly onChange: () => void;
  private readonly onReset: () => void;
  private readonly exportNote = document.createElement('p');
  private readonly exportText = document.createElement('textarea');

  constructor(container: HTMLElement, onChange: () => void, onReset: () => void) {
    this.onChange = onChange;
    this.onReset = onReset;
    // Some settings grey others out, so every change re-syncs the panel first.
    const changed = () => {
      this.sync();
      onChange();
    };
    const control = (key: SettingKey): HTMLElement => {
      if (isChoice(key)) {
        const input = new ChoiceInput(`p-${key}`, CHOICES[key], defaultOptions[key], changed);
        this.choices.set(key, input);
        return input.element;
      }
      const spec = SPECS[key];
      const value = spec.percent ? Math.round(defaultOptions[key] * 100) : defaultOptions[key];
      const input = new NumberInput(`p-${key}`, spec.label, spec.title, spec, value, changed);
      this.numbers.set(key, input);
      return input.element;
    };

    this.lock = new CheckInput(
      'p-lock', 'Zamknout rozmístění',
      'Boxy zůstanou na svých místech: šířka a výška buňky a měřítka generací je jen ' +
        'překreslí v nové velikosti (mohou se překrývat, pak mají červený obrys). Ostatní ' +
        'parametry rozložení jsou zamčené. Po odemknutí se strom znovu rozmístí.',
      DEFAULT_LOCKED,
      changed,
    );

    // Render-only: no re-sync needed (they never depend on or grey out the layout settings).
    const lineInput = (key: keyof typeof LINE_SPECS) => {
      const spec = LINE_SPECS[key];
      return new NumberInput(`p-${key}`, spec.label, spec.title, spec, spec.value, onChange);
    };
    this.minLine = lineInput('minLineWidth');
    this.maxLine = lineInput('maxLineWidth');
    this.nameSize = new NumberInput('p-nameScale', NAME_SPEC.label, NAME_SPEC.title, NAME_SPEC, NAME_SPEC.value, onChange);

    // Filled by setGenerations() once the data is known.
    this.levelSection = section('Měřítko generací');
    this.levelSection.hidden = true;

    const reset = document.createElement('button');
    reset.id = 'reset';
    reset.textContent = 'Výchozí';
    reset.title = 'Vrátit všechny hodnoty na výchozí (rozmístění se spočítá znovu a zamkne)';
    reset.addEventListener('click', () => this.reset());

    const exportRow = document.createElement('div');
    exportRow.className = 'export-row';
    exportRow.append(
      button('Kopírovat nastavení', 'Zkopírovat všechny hodnoty panelu jako text (JSON) do schránky', () => this.copy()),
      button('Uložit jako soubor', 'Stáhnout všechny hodnoty panelu jako soubor .json', () => this.download()),
    );
    this.exportNote.className = 'export-note';
    this.exportNote.setAttribute('role', 'status');
    this.exportText.className = 'export-text';
    this.exportText.readOnly = true;
    this.exportText.rows = 8;
    this.exportText.hidden = true;
    this.exportText.setAttribute('aria-label', 'Nastavení (JSON)');

    container.append(
      section('Rozměry', this.lock.element, control('cellWidth'), control('cellHeight')),
      this.levelSection,
      section('Mezery', control('ringGap'), control('siblingGap'), control('cousinGap'),
        control('spread'), control('lean'), control('maxGap')),
      section('Partneři', control('partnerMode'), control('partnerThreshold')),
      section('Vzhled', this.nameSize.element, this.minLine.element, this.maxLine.element),
      reset,
      exportRow,
      this.exportNote,
      this.exportText,
    );
    this.sync();
  }

  /** One size multiplier per generation 0..maxLevel of the loaded data. */
  setGenerations(maxLevel: number) {
    this.levels = [];
    for (let l = 0; l <= maxLevel; l++) {
      const label = l === 0 ? 'Generace 0 (kořen)' : `Generace ${l}`;
      const title = 'Násobek velikosti buněk v této generaci';
      this.levels.push(new NumberInput(`p-level-${l}`, label, title, LEVEL_RANGE, defaultScale(l), this.onChange));
    }
    this.levelSection.replaceChildren(this.levelSection.firstChild!, ...this.levels.map((c) => c.element));
    this.levelSection.hidden = false;
  }

  options(): Partial<LayoutOptions> {
    const o: Partial<LayoutOptions> = {};
    for (const [key, input] of this.numbers) o[key] = SPECS[key].percent ? input.value / 100 : input.value;
    // A choice only offers the values of its own option type.
    for (const [key, input] of this.choices) Object.assign(o, { [key]: input.value });
    if (this.levels.length > 0) o.levelScale = this.levels.map((c) => c.value);
    return o;
  }

  /** The render-only settings (name size, line widths); the normal view always gets the defaults. */
  appearance(): Appearance {
    const width = (input: NumberInput, key: keyof typeof LINE_SPECS) =>
      input.value === LINE_SPECS[key].value ? undefined : input.value;
    return {
      minLineWidth: width(this.minLine, 'minLineWidth'),
      maxLineWidth: width(this.maxLine, 'maxLineWidth'),
      nameScale: this.nameSize.value === NAME_SPEC.value ? undefined : this.nameSize.value / 100,
    };
  }

  /** Whether the layout is locked: size changes only resize the boxes in place. */
  get locked(): boolean {
    return this.lock.value;
  }

  /**
   * Every panel value as pretty-printed JSON: layout options as `LayoutOptions` holds them
   * (spread/lean as fractions, not %), the actual line widths, the lock and, when locked, the
   * sizes the locked layout was computed with; `changed` lists what differs from the default.
   */
  settingsJson(): string {
    const changed: string[] = [];
    for (const [key, input] of [...this.numbers, ...this.choices]) if (input.isChanged) changed.push(key);
    this.levels.forEach((input, l) => input.isChanged && changed.push(`levelScale[${l}]`));
    const look: [string, { isChanged: boolean }][] = [
      ['locked', this.lock], ['nameScale', this.nameSize], ['minLineWidth', this.minLine], ['maxLineWidth', this.maxLine],
    ];
    for (const [key, input] of look) if (input.isChanged) changed.push(key);
    const settings = {
      version: 1,
      exported: new Date().toISOString(),
      layout: this.options(),
      appearance: {
        nameScale: this.nameSize.value / 100,
        minLineWidth: this.minLine.value,
        maxLineWidth: this.maxLine.value,
      },
      locked: this.locked,
      lockedLayout: this.locked ? this.lockedSizes() : null,
      changed,
    };
    return JSON.stringify(settings, null, 2);
  }

  /** Clipboard API, else a selected textarea + execCommand, else the text left to copy by hand. */
  private async copy() {
    const text = this.settingsJson();
    this.exportText.value = text;
    try {
      await navigator.clipboard.writeText(text);
      this.exportText.hidden = true;
      this.note('Zkopírováno');
      return;
    } catch {
      // Not available (e.g. no secure context): fall through.
    }
    this.exportText.hidden = false;
    this.exportText.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    this.exportText.hidden = copied;
    this.note(copied ? 'Zkopírováno' : 'Schránka není dostupná: zkopírujte text níže (Ctrl+C).', !copied);
  }

  private download() {
    const url = URL.createObjectURL(new Blob([this.settingsJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rodokmen-nastaveni-${stamp()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.note('Uloženo');
  }

  private noteTimer = 0;

  /** A short confirmation under the buttons; `keep` leaves it until the next export. */
  private note(text: string, keep = false) {
    clearTimeout(this.noteTimer);
    this.exportNote.textContent = text;
    if (!keep) this.noteTimer = window.setTimeout(() => (this.exportNote.textContent = ''), 2500);
  }

  /**
   * Back to the defaults (no reload): locked again, display scales. `onReset` tells main.ts
   * to compute the layout behind the lock afresh from the standard sizes.
   */
  reset() {
    const inputs = [
      ...this.numbers.values(), ...this.choices.values(), this.lock, ...this.levels,
      this.nameSize, this.minLine, this.maxLine,
    ];
    for (const input of inputs) input.restoreDefault();
    this.sync();
    this.onReset();
  }

  /**
   * While locked only the sizes stay enabled; the threshold only matters for the least-angle
   * partner mode, the family lean only when something is spread (above 0 %).
   */
  private sync() {
    const locked = this.lock.value;
    const why = locked ? LOCKED_NOTE : null;
    for (const input of this.choices.values()) input.disable(locked, why);
    const spreadOff = this.numbers.get('spread')!.value === 0;
    for (const [key, input] of this.numbers) {
      if (SIZE_KEYS.includes(key)) continue;
      const leanOff = (key === 'lean' || key === 'maxGap') && spreadOff;
      const unused = leanOff || (key === 'partnerThreshold' && this.choices.get('partnerMode')!.value !== 'angle');
      input.disable(locked || unused, why ?? (leanOff ? SPREAD_OFF_NOTE : null));
    }
  }
}