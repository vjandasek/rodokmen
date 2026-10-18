/**
 * Editing UI (developer mode): a context menu on a person (right click on their cell in the tree),
 * the details dialog, delete confirmations, the family name dialog (main.ts opens it from the
 * title) and Ctrl+Z. The data operations are in edit.ts; after
 * each change `changed` redraws the tree from `editor.file`.
 */
import { EditError, isValidDate, type FamilyEditor, type PersonDetails } from './edit.ts';
import type { Person } from './model.ts';

/** One menu item; `disabled` greys it out. */
interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

/** The extra choices of the details dialog besides the person's own details. */
interface DialogExtras {
  /** "Sezdáni" checkbox (partners). */
  married?: boolean;
  /** "Druhý rodič" select (children of a parent with partners). */
  otherParent?: { choices: Person[]; value: number | null };
}

type Submit = (details: PersonDetails, married: boolean, otherParent: number | null) => void;

/** Holding a finger on a person this long (ms) opens the menu (phones have no right click). */
const LONG_PRESS = 500;
/** A hold that moves this far (px) is a pan, not a long press. */
const HOLD_SLOP = 8;

export class EditorUI {
  /** Called when a long press opens the menu (the person card must not take it as a tap). */
  onLongPress?: () => void;
  private readonly editor: FamilyEditor;
  private readonly changed: () => void;
  private menu: HTMLElement | null = null;

  constructor(editor: FamilyEditor, svg: SVGSVGElement, changed: () => void) {
    this.editor = editor;
    this.changed = changed;
    // Only a click on a person opens our menu; elsewhere the browser's menu stays.
    svg.addEventListener('contextmenu', (e) => {
      const cell = (e.target as Element).closest?.('[data-person]');
      if (!cell) return;
      e.preventDefault();
      this.openMenu(Number(cell.getAttribute('data-person')), e.clientX, e.clientY);
    });
    // Touch and pen: a finger held still on a person opens the same menu.
    let hold: { pointer: number; x: number; y: number; timer: number } | null = null;
    const cancelHold = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    svg.addEventListener('pointerdown', (e) => {
      cancelHold();
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-person]');
      if (!cell) return;
      const { clientX: x, clientY: y } = e;
      const timer = window.setTimeout(() => {
        hold = null;
        navigator.vibrate?.(30);
        this.onLongPress?.();
        this.openMenu(Number(cell.getAttribute('data-person')), x, y);
      }, LONG_PRESS);
      hold = { pointer: e.pointerId, x, y, timer };
    });
    svg.addEventListener('pointermove', (e) => {
      if (hold && e.pointerId === hold.pointer && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) >= HOLD_SLOP) cancelHold();
    });
    svg.addEventListener('pointerup', cancelHold);
    svg.addEventListener('pointercancel', cancelHold);
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
      },
      true,
    );
    window.addEventListener('wheel', () => this.closeMenu(), { capture: true, passive: true });
    window.addEventListener('resize', () => this.closeMenu());
    window.addEventListener('blur', () => this.closeMenu());
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.menu) {
      e.preventDefault();
      this.closeMenu();
      return;
    }
    // Ctrl+Z: undo the last edit, unless typing in a field or a dialog is open.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      const target = e.target as HTMLElement;
      if (target.closest?.('input, select, textarea, [contenteditable]')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      this.closeMenu();
      if (this.editor.undo()) this.changed();
    }
  }

  private openMenu(id: number, x: number, y: number) {
    this.closeMenu();
    const person = this.editor.person(id);
    const blood = this.editor.partnerOf(id);
    const items: MenuItem[] = [{ label: 'Upravit údaje…', action: () => this.editDetails(person, blood) }];
    if (blood) {
      const partners = this.editor.partners(blood.id);
      if (partners.length >= 2) {
        const index = partners.findIndex((p) => p.id === id);
        items.push(
          { label: 'Posunout dříve', disabled: index === 0, action: () => this.run(() => this.editor.movePartner(blood.id, id, -1)) },
          {
            label: 'Posunout později',
            disabled: index === partners.length - 1,
            action: () => this.run(() => this.editor.movePartner(blood.id, id, 1)),
          },
        );
      }
      items.push({ label: 'Odebrat partnera…', action: () => this.confirmDelete(person, () => this.editor.removePartner(blood.id, id)) });
    } else {
      items.push(
        { label: 'Přidat partnera…', action: () => this.addPartner(person) },
        { label: 'Přidat dítě…', action: () => this.addChild(person) },
        { label: 'Smazat osobu…', action: () => this.confirmDelete(person, () => this.editor.deletePerson(id)) },
      );
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    const heading = document.createElement('div');
    heading.className = 'menu-heading';
    heading.textContent = fullName(person);
    menu.append(heading);
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.disabled = !!item.disabled;
      button.addEventListener('click', () => {
        this.closeMenu();
        item.action();
      });
      menu.append(button);
    }
    document.body.append(menu);
    // Kept inside the window.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
    this.menu = menu;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  /** A menu action without a dialog; a refusal is shown as a message. */
  private run(action: () => void) {
    try {
      action();
    } catch (e) {
      messageDialog('Úpravu nelze provést', errorText(e));
      return;
    }
    this.changed();
  }

  private editDetails(person: Person, blood: Person | null) {
    const extras: DialogExtras = {};
    if (blood) extras.married = blood.partners.find((r) => r.id === person.id)?.married ?? false;
    const choices = person.parentBlood !== null && !blood ? this.editor.partners(person.parentBlood) : [];
    if (choices.length > 0) extras.otherParent = { choices, value: person.parentNotBlood };
    personDialog(`Upravit údaje – ${fullName(person)}`, details(person), extras, (d, married, other) => {
      // One undo step; a refused part leaves everything unchanged.
      this.editor.batch(() => {
        this.editor.updatePerson(person.id, d);
        if (blood && married !== extras.married) this.editor.setMarried(blood.id, person.id, married);
        if (extras.otherParent && other !== person.parentNotBlood) this.editor.setOtherParent(person.id, other);
      });
      this.changed();
    });
  }

  private addPartner(blood: Person) {
    const empty = emptyDetails(blood.sex === 'M' ? 'F' : 'M');
    personDialog(`Nový partner – ${fullName(blood)}`, empty, { married: true }, (d, married) => {
      this.editor.addPartner(blood.id, d, married);
      this.changed();
    });
  }

  private addChild(parent: Person) {
    const choices = this.editor.partners(parent.id);
    const extras: DialogExtras = choices.length > 0 ? { otherParent: { choices, value: choices[0].id } } : {};
    personDialog(`Nové dítě – ${fullName(parent)}`, emptyDetails('M'), extras, (d, _married, other) => {
      this.editor.addChild(parent.id, d, other);
      this.changed();
    });
  }

  /** "Název rodu": the family name the title and the PDF show (empty = just "Rodokmen"). */
  editFamilyName() {
    this.closeMenu();
    if (document.querySelector('dialog[open]')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.editor.file.familyName ?? '';
    input.placeholder = 'např. Novákovi';
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = 'Název rodu';
    label.append(span, input);
    const fields = document.createElement('div');
    fields.className = 'fields';
    fields.append(label);
    const note = document.createElement('p');
    note.textContent = 'Zobrazí se v nadpisu („Rodokmen – …“) a v PDF. Prázdné pole = jen „Rodokmen“.';
    const dialog = makeDialog('Název rodu', [fields, note]);
    const form = dialog.querySelector('form')!;
    form.append(buttons('Uložit změny', dialog));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      dialog.close();
      const name = input.value.trim() || null;
      if (name !== (this.editor.file.familyName?.trim() || null)) this.run(() => this.editor.setFamilyName(name));
    });
    dialog.showModal();
    input.select();
  }

  /** Confirmation listing who will be deleted; a refusal shows its reason instead. */
  private confirmDelete(person: Person, remove: () => void) {
    let doomed: Person[];
    try {
      doomed = this.editor.deletionPreview(person.id);
    } catch (e) {
      messageDialog('Nelze smazat', errorText(e));
      return;
    }
    const intro = document.createElement('p');
    intro.textContent = doomed.length === 1 ? 'Smaže se tato osoba:' : 'Smažou se tyto osoby:';
    const list = document.createElement('ul');
    for (const p of doomed) {
      const li = document.createElement('li');
      li.textContent = fullName(p);
      list.append(li);
    }
    const dialog = makeDialog('Smazat', [intro, list]);
    const form = dialog.querySelector('form')!;
    form.append(buttons('Smazat', dialog, true));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      dialog.close();
      this.run(remove);
    });
    dialog.showModal();
  }
}

/** Title, first name and surname. */
function fullName(p: Person): string {
  return [p.title, p.firstName, p.lastName].filter(Boolean).join(' ');
}

function details(p: Person): PersonDetails {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    maidenName: p.maidenName,
    sex: p.sex,
    living: p.living,
    title: p.title ?? null,
    bornDate: p.bornDate ?? null,
    bornPlace: p.bornPlace ?? null,
    deathDate: p.deathDate ?? null,
    deathPlace: p.deathPlace ?? null,
  };
}

function emptyDetails(sex: 'M' | 'F'): PersonDetails {
  return {
    firstName: '',
    lastName: null,
    maidenName: null,
    sex,
    living: true,
    title: null,
    bornDate: null,
    bornPlace: null,
    deathDate: null,
    deathPlace: null,
  };
}

function errorText(e: unknown): string {
  return e instanceof EditError ? e.message : `Neočekávaná chyba: ${(e as Error).message}`;
}

/** The text fields of the dialog in order. */
const TEXT_FIELDS: { key: keyof PersonDetails; label: string; date?: boolean }[] = [
  { key: 'firstName', label: 'Jméno' },
  { key: 'lastName', label: 'Příjmení' },
  { key: 'maidenName', label: 'Rodné příjmení' },
  { key: 'title', label: 'Titul' },
  { key: 'bornDate', label: 'Datum narození', date: true },
  { key: 'bornPlace', label: 'Místo narození' },
  { key: 'deathDate', label: 'Datum úmrtí', date: true },
  { key: 'deathPlace', label: 'Místo úmrtí' },
];

/**
 * The details dialog. `submit` runs the edit; an `EditError` (or an invalid date) is shown in the
 * dialog, which stays open.
 */
function personDialog(title: string, initial: PersonDetails, extras: DialogExtras, submit: Submit) {
  const rows: HTMLElement[] = [];
  const inputs = new Map<keyof PersonDetails, HTMLInputElement>();
  const row = (label: string, control: HTMLElement) => {
    const l = document.createElement('label');
    l.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(span, control);
    rows.push(l);
  };
  const check = (label: string, checked: boolean) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const l = document.createElement('label');
    l.className = 'field check';
    l.append(input, label);
    rows.push(l);
    return input;
  };

  for (const f of TEXT_FIELDS) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = (initial[f.key] as string | null) ?? '';
    if (f.key === 'firstName') input.required = true;
    if (f.date) {
      input.placeholder = 'dd.mm.rrrr';
      input.inputMode = 'numeric';
    }
    inputs.set(f.key, input);
    row(f.label, input);
    // Sex and living sit after the names and title.
    if (f.key === 'title') {
      const sex = document.createElement('select');
      sex.add(new Option('muž', 'M'));
      sex.add(new Option('žena', 'F'));
      sex.value = initial.sex;
      sex.name = 'sex';
      row('Pohlaví', sex);
    }
  }
  const living = check('Žije', initial.living);
  const married = extras.married !== undefined ? check('Sezdáni', extras.married) : null;
  let other: HTMLSelectElement | null = null;
  if (extras.otherParent) {
    other = document.createElement('select');
    for (const p of extras.otherParent.choices) other.add(new Option(fullName(p), String(p.id)));
    other.add(new Option('neuveden', ''));
    other.value = extras.otherParent.value === null ? '' : String(extras.otherParent.value);
    row('Druhý rodič', other);
  }

  const error = document.createElement('p');
  error.className = 'dialog-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const fields = document.createElement('div');
  fields.className = 'fields';
  fields.append(...rows);
  const dialog = makeDialog(title, [fields, error]);
  const form = dialog.querySelector('form')!;
  form.append(buttons('Uložit změny', dialog));
  const showError = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = (key: keyof PersonDetails) => inputs.get(key)!.value.trim() || null;
    for (const f of TEXT_FIELDS.filter((f) => f.date)) {
      const value = text(f.key);
      if (value !== null && !isValidDate(value)) {
        showError(`${f.label}: zadejte platné datum ve tvaru dd.mm.rrrr (např. 05.03.1950).`);
        inputs.get(f.key)!.focus();
        return;
      }
    }
    const firstName = text('firstName');
    if (!firstName) {
      showError('Jméno je povinné.');
      return;
    }
    const d: PersonDetails = {
      firstName,
      lastName: text('lastName'),
      maidenName: text('maidenName'),
      sex: (form.querySelector<HTMLSelectElement>('select[name="sex"]')!.value as 'M' | 'F'),
      living: living.checked,
      title: text('title'),
      bornDate: text('bornDate'),
      bornPlace: text('bornPlace'),
      deathDate: text('deathDate'),
      deathPlace: text('deathPlace'),
    };
    try {
      submit(d, married?.checked ?? false, other && other.value !== '' ? Number(other.value) : null);
    } catch (err) {
      showError(errorText(err));
      return;
    }
    dialog.close();
  });
  dialog.showModal();
}

/** A modal dialog with a heading and a form holding `content`; removed from the page when closed. */
function makeDialog(title: string, content: HTMLElement[]): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'edit-dialog';
  const form = document.createElement('form');
  form.noValidate = true;
  const heading = document.createElement('h2');
  heading.textContent = title;
  form.append(heading, ...content);
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  return dialog;
}

/** OK (submits the form) and "Zrušit" (closes the dialog). */
function buttons(ok: string, dialog: HTMLDialogElement, danger = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dialog-buttons';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = danger ? 'primary danger' : 'primary';
  submit.textContent = ok;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Zrušit';
  cancel.addEventListener('click', () => dialog.close());
  row.append(submit, cancel);
  return row;
}

/** An information-only dialog (a refused edit). */
function messageDialog(title: string, text: string) {
  const p = document.createElement('p');
  p.textContent = text;
  const dialog = makeDialog(title, [p]);
  const row = document.createElement('div');
  row.className = 'dialog-buttons';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'primary';
  ok.textContent = 'OK';
  row.append(ok);
  const form = dialog.querySelector('form')!;
  form.append(row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    dialog.close();
  });
  dialog.showModal();
}
