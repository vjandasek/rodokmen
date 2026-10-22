/**
 * Last line of defence before publishing: no name, place or date from the full family data may
 * appear in plain text in the built site (the data is only there encrypted).
 */
import type { FamilyFile } from '../src/model.ts';

/** Lower case without diacritics, so "Novák" also matches "novak". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Words that must not be readable in the site: every name, surname, maiden name, place and the
 * family name (words of 4+ letters, folded), plus every date and title as written.
 */
export function sensitiveTerms(file: FamilyFile): Set<string> {
  const terms = new Set<string>();
  const words = (text: string | null | undefined) => {
    for (const w of fold(text ?? '').split(/[^\p{L}]+/u)) if (w.length >= 4) terms.add(w);
  };
  words(file.familyName);
  for (const p of file.people) {
    for (const text of [p.firstName, p.lastName, p.maidenName, p.bornPlace, p.deathPlace]) words(text);
    for (const text of [p.bornDate, p.deathDate, p.title]) if (text?.trim()) terms.add(fold(text.trim()));
  }
  return terms;
}

/**
 * Library identifiers that contain a word which is also a name in the data (folded). They are
 * blanked out before the check; add one only after seeing it is library code, not data.
 */
export const LIBRARY_PHRASES = ['lower-roman', 'upper-roman', 'times-roman'];

/** The terms found in `text` as whole words, each with a little context. */
export function findLeaks(text: string, terms: Set<string>): { term: string; context: string }[] {
  let folded = fold(text);
  for (const phrase of LIBRARY_PHRASES) folded = folded.replaceAll(phrase, ' '.repeat(phrase.length));
  const found: { term: string; context: string }[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`, 'u').exec(folded);
    if (m) found.push({ term, context: folded.slice(Math.max(0, m.index - 30), m.index + term.length + 30) });
  }
  return found;
}
