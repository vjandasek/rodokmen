import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_FILE = /^family(-\d{4}-\d{2}-\d{2}_\d{4})?\.json$/;

/**
 * The newest data file in `dir`: family.json or a saved family-YYYY-MM-DD_HHMM.json (the dated
 * names sort by time, plain family.json is the oldest). Null when there is none.
 */
export function newestDataFile(dir: string): string | null {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => DATA_FILE.test(n));
  } catch {
    // No data directory: treated as no file.
  }
  // '-' sorts before '.', so put the plain family.json first explicitly.
  const rank = (n: string) => (n === 'family.json' ? '' : n);
  names.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
  const newest = names.at(-1);
  return newest ? join(dir, newest) : null;
}
