/**
 * Finding a person by name (the header search box): accents and case are ignored, every typed
 * word must start a word of the person's names (first name, surname, maiden name). Partners are
 * found too. Pure: no DOM, so it is tested in Node.
 */
import type { FamilyFile, Person } from './model.ts';
import { displayName } from './details.ts';

export interface SearchHit {
  id: number;
  /** Display name (title, first name, surname). */
  name: string;
  /** What tells people of the same name apart: maiden name, parents or partner, birth year. */
  detail: string;
}

/** Lower case without accents: "Žluťoučká" → "zlutoucka". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Words of a text, normalized. */
function words(text: string | null | undefined): string[] {
  return normalize(text ?? '').split(/[\s\-.,]+/).filter((w) => w);
}

/** People matching `query`, best first (whole-name matches, then by surname and first name). */
export function searchPeople(file: FamilyFile, query: string, limit = 8): SearchHit[] {
  const typed = words(query);
  if (typed.length === 0) return [];
  const byId = new Map(file.people.map((p) => [p.id, p]));
  const owner = new Map<number, Person>();
  for (const p of file.people) for (const r of p.partners) owner.set(r.id, p);

  const hits = file.people
    .map((p) => {
      const own = [...words(p.firstName), ...words(p.lastName), ...words(p.maidenName)];
      if (!typed.every((t) => own.some((w) => w.startsWith(t)))) return null;
      // Typed words that are whole words of the name rank higher ("jan" before "jana").
      const whole = typed.filter((t) => own.includes(t)).length;
      return { p, whole };
    })
    .filter((h): h is { p: Person; whole: number } => h !== null);

  const sortKey = (p: Person) => normalize(`${p.lastName ?? ''} ${p.firstName}`);
  hits.sort((a, b) => b.whole - a.whole || sortKey(a.p).localeCompare(sortKey(b.p)) || a.p.id - b.p.id);

  return hits.slice(0, limit).map(({ p }) => ({ id: p.id, name: displayName(p), detail: detail(p, byId, owner) }));
}

function detail(p: Person, byId: Map<number, Person>, owner: Map<number, Person>): string {
  const parts: string[] = [];
  if (p.maidenName) parts.push(`roz. ${p.maidenName}`);
  const partnerOf = owner.get(p.id);
  if (partnerOf) {
    parts.push(`${p.sex === 'F' ? 'partnerka' : 'partner'}: ${displayName(partnerOf)}`);
  } else if (p.parentBlood !== null) {
    const parents = [p.parentBlood, p.parentNotBlood]
      .map((id) => (id === null ? undefined : byId.get(id)?.firstName))
      .filter((n): n is string => !!n);
    if (parents.length > 0) parts.push(`${p.sex === 'F' ? 'dcera' : 'syn'}: ${parents.join(' a ')}`);
  }
  const year = /^\d{2}\.\d{2}\.(\d{4})$/.exec(p.bornDate ?? '')?.[1];
  if (year) parts.push(`nar. ${year}`);
  return parts.join(' · ');
}
