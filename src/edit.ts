/**
 * Editing the family data (developer mode). Pure data operations on a `FamilyFile`, with an undo
 * stack and an "unsaved changes" flag; no DOM. The UI (editor.ts) calls these and redraws.
 *
 * Every mutation validates the result (one root, partners not blood-related, no dangling
 * references, no cycles, child's other parent is a partner of its blood parent). A refused or
 * failed operation leaves the data unchanged and throws `EditError` with a Czech message the UI
 * shows as is.
 */
import type { FamilyFile, PartnerRef, Person } from './model.ts';

/** The editable details of a person (the rest — ids, links, bloodRelated — is managed here). */
export interface PersonDetails {
  firstName: string;
  lastName: string | null;
  maidenName: string | null;
  sex: 'M' | 'F';
  living: boolean;
  title: string | null;
  /** Strict 'dd.mm.yyyy' (a real calendar date) or null. */
  bornDate: string | null;
  bornPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
}

/** A refused edit; `message` is Czech and meant for the user. */
export class EditError extends Error {}

/** Undo history length. */
export const UNDO_LIMIT = 100;

/** True for a real calendar date written exactly as dd.mm.yyyy (e.g. 15.03.1990). */
export function isValidDate(text: string): boolean {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return false;
  const [d, m, y] = text.split('.').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

/** The file as written to disk: 2-space JSON with a trailing newline. */
export function serialize(file: FamilyFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** Suggested name for a saved copy at `now`: family-YYYY-MM-DD_HHMM.json (local time). */
export function savedFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `family-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}.json`
  );
}

/** Display name for messages. */
function label(p: Person): string {
  return [p.title, p.firstName, p.lastName].filter((s) => s).join(' ');
}

/** Person with keys in the files' order (details after `partners`). */
function canonical(p: Person): Person {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    maidenName: p.maidenName,
    sex: p.sex,
    living: p.living,
    bloodRelated: p.bloodRelated,
    parentBlood: p.parentBlood,
    parentNotBlood: p.parentNotBlood,
    partners: p.partners,
    title: p.title ?? null,
    bornDate: p.bornDate ?? null,
    bornPlace: p.bornPlace ?? null,
    deathDate: p.deathDate ?? null,
    deathPlace: p.deathPlace ?? null,
  };
}

const optionalText = (s: string | null | undefined): string | null => {
  const t = s?.trim() ?? '';
  return t === '' ? null : t;
};

const DATE_HINT = 've tvaru dd.mm.rrrr (např. 15.03.1990).';

/** Normalizes user input (trim, empty → null) and checks the name and dates. */
function cleanDetails(details: Partial<PersonDetails>): Partial<PersonDetails> {
  const out: Partial<PersonDetails> = {};
  for (const [key, value] of Object.entries(details) as [keyof PersonDetails, unknown][]) {
    if (value === undefined) continue;
    if (key === 'firstName') {
      const name = typeof value === 'string' ? value.trim() : '';
      if (!name) throw new EditError('Jméno je povinné.');
      out.firstName = name;
    } else if (key === 'sex') {
      if (value !== 'M' && value !== 'F') throw new EditError('Pohlaví musí být M nebo F.');
      out.sex = value;
    } else if (key === 'living') {
      out.living = Boolean(value);
    } else {
      out[key] = optionalText(value as string | null) as never;
    }
  }
  if (out.bornDate && !isValidDate(out.bornDate)) {
    throw new EditError(`Datum narození musí být ${DATE_HINT}`);
  }
  if (out.deathDate && !isValidDate(out.deathDate)) {
    throw new EditError(`Datum úmrtí musí být ${DATE_HINT}`);
  }
  return out;
}

/** Throws `EditError` describing the first broken rule of the whole file. */
export function validateFile(file: FamilyFile): void {
  const byId = new Map<number, Person>();
  for (const p of file.people) {
    if (byId.has(p.id)) throw new EditError(`Id ${p.id} je použito vícekrát.`);
    byId.set(p.id, p);
  }
  const root = byId.get(file.rootId);
  if (!root) throw new EditError('Kořenová osoba stromu chybí.');

  const owner = new Map<number, number>();
  for (const p of file.people) {
    const seen = new Set<number>();
    for (const r of p.partners) {
      const partner = byId.get(r.id);
      if (!partner) throw new EditError(`${label(p)}: partner ${r.id} neexistuje.`);
      if (!p.bloodRelated) throw new EditError(`${label(p)} není pokrevní příbuzný, nemůže mít partnery.`);
      if (partner.bloodRelated) throw new EditError(`${label(partner)} je pokrevní příbuzný, nemůže být partnerem.`);
      if (seen.has(r.id)) throw new EditError(`${label(partner)} je u ${label(p)} uveden(a) dvakrát.`);
      seen.add(r.id);
      if (owner.has(r.id)) throw new EditError(`${label(partner)} je partnerem více osob.`);
      owner.set(r.id, p.id);
    }
  }

  for (const p of file.people) {
    if (p.bornDate && !isValidDate(p.bornDate)) throw new EditError(`${label(p)}: datum narození musí být ${DATE_HINT}`);
    if (p.deathDate && !isValidDate(p.deathDate)) throw new EditError(`${label(p)}: datum úmrtí musí být ${DATE_HINT}`);
    if (!p.bloodRelated) {
      if (!owner.has(p.id)) throw new EditError(`${label(p)} není pokrevní příbuzný ani ničí partner.`);
      if (p.parentBlood !== null || p.parentNotBlood !== null) {
        throw new EditError(`${label(p)} není pokrevní příbuzný, nemůže mít rodiče ve stromu.`);
      }
      continue;
    }
    if (p.id === file.rootId) {
      if (p.parentBlood !== null || p.parentNotBlood !== null) throw new EditError('Kořenová osoba nesmí mít rodiče.');
      continue;
    }
    if (p.parentBlood === null) throw new EditError(`${label(p)} nemá pokrevního rodiče (strom smí mít jen jeden kořen).`);
    const parent = byId.get(p.parentBlood);
    if (!parent) throw new EditError(`${label(p)}: rodič ${p.parentBlood} neexistuje.`);
    if (!parent.bloodRelated) throw new EditError(`${label(p)}: pokrevní rodič není pokrevní příbuzný.`);
    if (p.parentNotBlood !== null && !parent.partners.some((r) => r.id === p.parentNotBlood)) {
      throw new EditError(`${label(p)}: druhý rodič není partnerem rodiče ${label(parent)}.`);
    }
    // Walk up to the root; a repeated id means a cycle.
    const seen = new Set<number>([p.id]);
    let cur = parent;
    while (cur.id !== file.rootId) {
      if (seen.has(cur.id) || cur.parentBlood === null) throw new EditError(`${label(p)}: cyklus v rodičích.`);
      seen.add(cur.id);
      const next = byId.get(cur.parentBlood);
      if (!next) throw new EditError(`${label(cur)}: rodič ${cur.parentBlood} neexistuje.`);
      cur = next;
    }
  }
}

export class FamilyEditor {
  private data: FamilyFile;
  private undoStack: { file: FamilyFile; state: number }[] = [];
  /** Identifies the current state; `savedState` is the one last loaded or saved. */
  private state = 0;
  private savedState = 0;
  private nextState = 1;

  constructor(file: FamilyFile) {
    this.data = structuredClone(file);
  }

  /** The current data (do not mutate it directly). */
  get file(): FamilyFile {
    return this.data;
  }

  /** Changes since the load or the last `markSaved`. */
  get dirty(): boolean {
    return this.state !== this.savedState;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Reverts the last successful mutation; false when there is nothing to undo. */
  undo(): boolean {
    const last = this.undoStack.pop();
    if (!last) return false;
    this.data = last.file;
    this.state = last.state;
    return true;
  }

  markSaved(): void {
    this.savedState = this.state;
  }

  person(id: number): Person {
    const p = this.data.people.find((x) => x.id === id);
    if (!p) throw new EditError(`Osoba ${id} neexistuje.`);
    return p;
  }

  /** The blood relative a partner belongs to (whose `partners` list contains `partnerId`), or null. */
  partnerOf(partnerId: number): Person | null {
    return this.data.people.find((p) => p.partners.some((r) => r.id === partnerId)) ?? null;
  }

  /** The partners of a blood relative in their order. */
  partners(bloodId: number): Person[] {
    return [...this.person(bloodId).partners].sort((a, b) => a.order - b.order).map((r) => this.person(r.id));
  }

  updatePerson(id: number, details: Partial<PersonDetails>): void {
    const clean = cleanDetails(details);
    this.mutate((f) => {
      const i = f.people.findIndex((p) => p.id === id);
      if (i < 0) throw new EditError(`Osoba ${id} neexistuje.`);
      f.people[i] = canonical({ ...f.people[i], ...clean });
    });
  }

  setMarried(bloodId: number, partnerId: number, married: boolean): void {
    this.mutate((f) => {
      partnerRef(f, bloodId, partnerId).married = married;
    });
  }

  /** New partner (not blood-related) appended as the last partner of `bloodId`; returns the new id. */
  addPartner(bloodId: number, details: PersonDetails, married: boolean): number {
    const clean = cleanDetails(details) as PersonDetails;
    if (!clean.firstName) throw new EditError('Jméno je povinné.');
    const id = this.newId();
    this.mutate((f) => {
      const blood = find(f, bloodId);
      f.people.push(newPerson(id, clean, false, null, null));
      blood.partners.push({ id, married, order: blood.partners.length });
      renumber(blood);
    });
    return id;
  }

  /** Moves a partner one place earlier (-1) or later (+1); orders are renumbered 0..n-1. */
  movePartner(bloodId: number, partnerId: number, delta: -1 | 1): void {
    this.mutate((f) => {
      const blood = find(f, bloodId);
      renumber(blood);
      const i = blood.partners.findIndex((r) => r.id === partnerId);
      if (i < 0) throw new EditError(`${label(find(f, partnerId))} není partnerem ${label(blood)}.`);
      const j = i + delta;
      if (j < 0 || j >= blood.partners.length) throw new EditError('Partnera nelze posunout dál.');
      [blood.partners[i], blood.partners[j]] = [blood.partners[j], blood.partners[i]];
      blood.partners.forEach((r, k) => (r.order = k));
    });
  }

  /**
   * Removes a partner (and deletes that person). Refused while a child names them as the other
   * parent.
   */
  removePartner(bloodId: number, partnerId: number): void {
    this.mutate((f) => {
      partnerRef(f, bloodId, partnerId);
      checkNotOtherParent(f, find(f, partnerId));
      removePartnerFrom(find(f, bloodId), partnerId);
      f.people = f.people.filter((p) => p.id !== partnerId);
    });
  }

  /**
   * New blood-related child of `parentId`; `otherParentId` must be one of its partners or null.
   * Returns the new id.
   */
  addChild(parentId: number, details: PersonDetails, otherParentId: number | null): number {
    const clean = cleanDetails(details) as PersonDetails;
    if (!clean.firstName) throw new EditError('Jméno je povinné.');
    const id = this.newId();
    this.mutate((f) => {
      const parent = find(f, parentId);
      if (!parent.bloodRelated) throw new EditError(`${label(parent)} není pokrevní příbuzný; dítě přidejte k jeho partnerovi.`);
      if (otherParentId !== null) partnerRef(f, parentId, otherParentId);
      f.people.push(newPerson(id, clean, true, parentId, otherParentId));
    });
    return id;
  }

  /** Sets which partner of the child's blood parent is its other parent (or null = unknown). */
  setOtherParent(childId: number, otherParentId: number | null): void {
    this.mutate((f) => {
      const child = find(f, childId);
      if (child.parentBlood === null) throw new EditError(`${label(child)} nemá rodiče ve stromu.`);
      if (otherParentId !== null) partnerRef(f, child.parentBlood, otherParentId);
      child.parentNotBlood = otherParentId;
    });
  }

  /**
   * Who `deletePerson(id)` would delete: the person and, for a blood relative, their partners.
   * Throws `EditError` when deleting is not allowed (the root; a person with children; a partner
   * a child names as the other parent).
   */
  deletionPreview(id: number): Person[] {
    return deletionSet(this.data, id).map((pid) => this.person(pid));
  }

  /** Deletes as `deletionPreview` describes; returns the deleted ids. */
  deletePerson(id: number): number[] {
    let ids: number[] = [];
    this.mutate((f) => {
      ids = deletionSet(f, id);
      const owner = f.people.find((p) => p.partners.some((r) => r.id === id));
      if (owner) removePartnerFrom(owner, id);
      const gone = new Set(ids);
      f.people = f.people.filter((p) => !gone.has(p.id));
    });
    return ids;
  }

  /** Runs several edits as one: a single undo step, and nothing changes if any of them is refused. */
  batch(edits: () => void): void {
    const data = this.data;
    const state = this.state;
    const stack = [...this.undoStack];
    try {
      edits();
    } catch (e) {
      this.data = data;
      this.state = state;
      this.undoStack = stack;
      throw e;
    }
    if (this.state === state) return;
    this.undoStack = [...stack, { file: data, state }];
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  private newId(): number {
    return this.data.people.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  }

  /** Applies `change` to a copy; keeps it only when the whole file validates. */
  private mutate(change: (f: FamilyFile) => void): void {
    const next = structuredClone(this.data);
    change(next);
    validateFile(next);
    this.undoStack.push({ file: this.data, state: this.state });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.data = next;
    this.state = this.nextState++;
  }
}

function find(f: FamilyFile, id: number): Person {
  const p = f.people.find((x) => x.id === id);
  if (!p) throw new EditError(`Osoba ${id} neexistuje.`);
  return p;
}

function partnerRef(f: FamilyFile, bloodId: number, partnerId: number): PartnerRef {
  const blood = find(f, bloodId);
  const ref = blood.partners.find((r) => r.id === partnerId);
  if (!ref) throw new EditError(`${label(find(f, partnerId))} není partnerem ${label(blood)}.`);
  return ref;
}

/** Sorts partners by order and renumbers them 0..n-1. */
function renumber(blood: Person): void {
  blood.partners.sort((a, b) => a.order - b.order).forEach((r, i) => (r.order = i));
}

function removePartnerFrom(blood: Person, partnerId: number): void {
  blood.partners = blood.partners.filter((r) => r.id !== partnerId);
  renumber(blood);
}

function checkNotOtherParent(f: FamilyFile, partner: Person): void {
  const child = f.people.find((p) => p.parentNotBlood === partner.id);
  if (child) {
    throw new EditError(`Nelze odebrat: ${label(partner)} je uveden(a) jako rodič dítěte ${label(child)}.`);
  }
}

/** Ids `deletePerson(id)` removes, or `EditError` when it is not allowed. */
function deletionSet(f: FamilyFile, id: number): number[] {
  const p = find(f, id);
  if (!p.bloodRelated) {
    checkNotOtherParent(f, p);
    return [id];
  }
  if (id === f.rootId) throw new EditError('Nelze smazat kořenovou osobu stromu.');
  const child = f.people.find((c) => c.parentBlood === id);
  if (child) throw new EditError(`Nelze smazat: ${label(p)} má děti (např. ${label(child)}).`);
  return [id, ...[...p.partners].sort((a, b) => a.order - b.order).map((r) => r.id)];
}

function newPerson(
  id: number,
  d: PersonDetails,
  bloodRelated: boolean,
  parentBlood: number | null,
  parentNotBlood: number | null,
): Person {
  return canonical({
    id,
    firstName: d.firstName,
    lastName: d.lastName ?? null,
    maidenName: d.maidenName ?? null,
    sex: d.sex,
    living: d.living,
    bloodRelated,
    parentBlood,
    parentNotBlood,
    partners: [],
    title: d.title ?? null,
    bornDate: d.bornDate ?? null,
    bornPlace: d.bornPlace ?? null,
    deathDate: d.deathDate ?? null,
    deathPlace: d.deathPlace ?? null,
  });
}
