/**
 * What the published (password-protected) site may show: living people lose their details, the
 * deceased keep everything. The full data never leaves the author's computer.
 */
import type { FamilyFile, Person } from './model.ts';

/**
 * The family file as published. Living people keep only their names: no birth date, birth place
 * or title, and no maiden name unless it is their only surname (then it becomes the surname).
 * Returns a copy; the input is not changed.
 */
export function stripForPublic(file: FamilyFile): FamilyFile {
  return { ...file, people: file.people.map(stripPerson) };
}

function stripPerson(p: Person): Person {
  if (!p.living) return { ...p, partners: p.partners.map((r) => ({ ...r })) };
  const lastName = p.lastName?.trim() || p.maidenName?.trim() || null;
  return {
    ...p,
    partners: p.partners.map((r) => ({ ...r })),
    lastName,
    maidenName: null,
    title: null,
    bornDate: null,
    bornPlace: null,
    deathDate: null,
    deathPlace: null,
  };
}

/** Born after this year and marked deceased without a death date: maybe still living. */
export const SUSPECT_DECEASED_AFTER = 1930;

/**
 * People whose details get published although they might be living: marked deceased, no death
 * date, and born after `SUSPECT_DECEASED_AFTER`. The publish script lists them before going on.
 */
export function suspectDeceased(file: FamilyFile): Person[] {
  return file.people.filter((p) => {
    if (p.living || p.deathDate) return false;
    const year = Number(/^\d{2}\.\d{2}\.(\d{4})$/.exec(p.bornDate ?? '')?.[1]);
    return year > SUSPECT_DECEASED_AFTER;
  });
}
