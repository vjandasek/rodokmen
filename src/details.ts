/**
 * What the person card shows (tap a person): the filled-in details and the closest relatives,
 * as ready-to-display Czech text. Pure: no DOM, so it is tested in Node.
 */
import type { FamilyFile, Person } from './model.ts';

/** One line of the card: a label ("Narození") and its text ("15.03.1990, Město"). */
export interface DetailRow {
  label: string;
  value: string;
}

export interface PersonCard {
  /** Display name: title, first name, surname; "† " in front for the deceased. */
  name: string;
  /** Only rows with something to show, in a fixed order. */
  rows: DetailRow[];
}

/** Title, first name, surname (missing parts skipped). */
export function displayName(person: Person): string {
  return [person.title, person.firstName, person.lastName]
    .map((s) => s?.trim())
    .filter((s) => s)
    .join(' ');
}

/** Czech word for "years" after `n`: 1 rok, 2–4 roky, otherwise let. */
export function yearsWord(n: number): string {
  if (n === 1) return 'rok';
  if (n >= 2 && n <= 4) return 'roky';
  return 'let';
}

/** Parses a strict 'dd.mm.yyyy' date to [year, month, day]; null when malformed. */
function parseDate(s: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** Full years from `from` to `to`; null when `to` is earlier. */
function fullYears(from: [number, number, number], to: [number, number, number]): number | null {
  let years = to[0] - from[0];
  if (to[1] < from[1] || (to[1] === from[1] && to[2] < from[2])) years--;
  return years < 0 ? null : years;
}

/** Joins the non-empty parts with ", ". */
function joinParts(...parts: (string | null | undefined)[]): string {
  return parts
    .map((s) => s?.trim())
    .filter((s) => s)
    .join(', ');
}

/** The card for person `id` as of `today` (for the age of the living). */
export function personCard(file: FamilyFile, id: number, today: Date): PersonCard {
  const byId = new Map(file.people.map((p) => [p.id, p]));
  const person = byId.get(id);
  if (!person) throw new Error(`Person ${id} not found`);
  const female = person.sex === 'F';
  const rows: DetailRow[] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push({ label, value });
  };

  add('Rodné příjmení', person.maidenName?.trim() ?? '');
  add('Narození', joinParts(person.bornDate, person.bornPlace));
  add('Úmrtí', joinParts(person.deathDate, person.deathPlace));

  const born = parseDate(person.bornDate);
  const end = person.living
    ? ([today.getFullYear(), today.getMonth() + 1, today.getDate()] as [number, number, number])
    : parseDate(person.deathDate);
  const age = born && end ? fullYears(born, end) : null;
  if (age !== null) {
    const label = person.living ? 'Věk' : female ? 'Dožila se' : 'Dožil se';
    add(label, `${age} ${yearsWord(age)}`);
  }

  if (person.bloodRelated && person.parentBlood !== null) {
    const parents = [person.parentBlood, person.parentNotBlood]
      .map((pid) => (pid === null ? undefined : byId.get(pid)))
      .filter((p): p is Person => p !== undefined)
      .map(displayName);
    add('Rodiče', parents.join(' a '));
  }

  // Partners: own partner list for a blood relative, the blood relative for a partner.
  const partnerRows: { partner: Person; married: boolean }[] = [];
  for (const ref of [...person.partners].sort((a, b) => a.order - b.order)) {
    const partner = byId.get(ref.id);
    if (partner) partnerRows.push({ partner, married: ref.married });
  }
  if (!person.bloodRelated) {
    for (const p of file.people) {
      const ref = p.partners.find((r) => r.id === id);
      if (ref) partnerRows.push({ partner: p, married: ref.married });
    }
  }
  for (const { partner, married } of partnerRows) {
    const f = partner.sex === 'F';
    const label = married ? (f ? 'Manželka' : 'Manžel') : f ? 'Partnerka' : 'Partner';
    add(label, displayName(partner));
  }

  // Children, grouped by the blood parent's partner order, then by id (as in buildTree).
  const kids = file.people.filter((c) =>
    person.bloodRelated ? c.parentBlood === id : c.parentNotBlood === id,
  );
  const rank = (c: Person) => {
    const bloodParent = c.parentBlood === null ? undefined : byId.get(c.parentBlood);
    const ref = bloodParent?.partners.find((r) => r.id === c.parentNotBlood);
    return ref ? ref.order : Number.MAX_SAFE_INTEGER;
  };
  kids.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  add('Děti', kids.map((c) => c.firstName.trim()).filter((s) => s).join(', '));

  // Only the card's own name carries the cross; relatives are listed by name alone.
  return { name: (person.living ? '' : '† ') + displayName(person), rows };
}
