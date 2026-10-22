/**
 * `npm run publish`: builds the public site with the family data stripped (strip.ts) and
 * encrypted with the family password (vault.ts) inside the page, checks that nothing readable
 * leaked, and replaces the `gh-pages` branch on GitHub with it (one commit, no older copies).
 *
 *   npm run publish                      newest data/family*.json, asks for the password
 *   npm run publish -- --data <file>     another data file
 *   npm run publish -- --dry-run         build and check only (dist-public/), no push
 *
 * The password can also come from the RODOKMEN_PASSWORD environment variable.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { build } from 'vite';
import { validateFile } from '../src/edit.ts';
import type { FamilyFile } from '../src/model.ts';
import { stripForPublic, suspectDeceased } from '../src/strip.ts';
import { normalizePassword, open, seal, vaultKey } from '../src/vault.ts';
import { newestDataFile } from './data-file.ts';
import { findLeaks, sensitiveTerms } from './leaks.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist-public');
const BRANCH = 'gh-pages';
/** The family password must be at least this long (after normalizePassword). */
const MIN_PASSWORD = 16;
/** Marks where the encrypted data goes in index.html. */
const VAULT_ID = 'family-vault';

function fail(text: string): never {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? fail(`${name} needs a value`));
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let text = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function password(): Promise<string> {
  const fromEnv = process.env.RODOKMEN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) fail('No terminal to ask for the password; set RODOKMEN_PASSWORD.');
  const first = await askHidden('Heslo rodiny: ');
  const second = await askHidden('Heslo znovu: ');
  if (normalizePassword(first) !== normalizePassword(second)) fail('The passwords differ.');
  return first;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dataPath = arg('--data') ?? newestDataFile(join(ROOT, 'data')) ?? fail('No data file in data/.');
  const full = JSON.parse(readFileSync(dataPath, 'utf8')) as FamilyFile;
  validateFile(full);
  console.log(`Data: ${relative(ROOT, dataPath)} (${full.people.length} people)`);

  const suspects = suspectDeceased(full);
  if (suspects.length) {
    console.log('\nMarked deceased without a death date, born after 1930; their details will be published:');
    for (const p of suspects) console.log(`  #${p.id} ${p.firstName} ${p.lastName ?? ''} * ${p.bornDate}`);
    if ((await ask('Continue? [y/N] ')).toLowerCase() !== 'y') fail('Stopped.');
  }

  const pass = await password();
  if (normalizePassword(pass).length < MIN_PASSWORD) {
    fail(`The password needs at least ${MIN_PASSWORD} characters; use 4–5 random unrelated words.`);
  }

  const stripped = stripForPublic(full);
  const json = JSON.stringify(stripped);
  console.log('Encrypting…');
  const vault = await seal(json, pass);
  if ((await open(vault, await vaultKey(vault, pass))) !== json) fail('The encrypted data does not decrypt back.');

  rmSync(OUT, { recursive: true, force: true });
  await build({ root: ROOT, logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } });
  const indexPath = join(OUT, 'index.html');
  const index = readFileSync(indexPath, 'utf8');
  const tag = `<script id="${VAULT_ID}" type="application/json">${JSON.stringify(vault)}</script>`;
  if (!index.includes('</body>')) fail('index.html has no </body>.');
  writeFileSync(indexPath, index.replace('</body>', `${tag}\n  </body>`));
  // GitHub Pages: serve the files as they are (no Jekyll).
  writeFileSync(join(OUT, '.nojekyll'), '');

  const terms = sensitiveTerms(full);
  let leaks = 0;
  for (const file of filesUnder(OUT)) {
    const bytes = readFileSync(file);
    if (bytes.subarray(0, 8000).includes(0)) continue; // fonts and other binaries
    for (const { term, context } of findLeaks(bytes.toString('utf8'), terms)) {
      console.error(`  leak: "${term}" in ${relative(OUT, file)}: …${context}…`);
      leaks++;
    }
  }
  if (leaks) fail(`${leaks} personal word(s) readable in the built site; nothing was published.`);
  console.log(`Checked ${terms.size} names, places and dates: none readable in the site.`);

  if (dryRun) {
    console.log(`\nDry run: the site is in ${relative(ROOT, OUT)}/ (try: npx vite preview --outDir ${relative(ROOT, OUT)}).`);
    return;
  }
  const origin = git(ROOT, 'remote', 'get-url', 'origin');
  if ((await ask(`\nReplace branch ${BRANCH} of ${origin} with this site? [y/N] `)).toLowerCase() !== 'y') {
    fail('Stopped; nothing was published.');
  }
  // A fresh one-commit repository each time, so the branch never keeps older encrypted copies.
  git(OUT, 'init', '-q', '-b', BRANCH);
  git(OUT, 'add', '-A');
  git(OUT, 'commit', '-q', '-m', `Publish ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  git(OUT, 'push', '-q', '--force', origin, `${BRANCH}:${BRANCH}`);
  rmSync(join(OUT, '.git'), { recursive: true, force: true });
  console.log(`\n✓ Published to branch ${BRANCH}. GitHub Pages updates within a minute or two.`);
}

await main();
