import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const DATA_DIR = join(import.meta.dirname, 'data');
const DATA_FILE = /^family(-\d{4}-\d{2}-\d{2}_\d{4})?\.json$/;

/**
 * Dev server only: GET /api/family-latest returns the newest data file in data/ (family.json or a
 * saved family-YYYY-MM-DD_HHMM.json; the dated names sort by time, plain family.json is the oldest),
 * with its name in the X-Family-File header. 404 when there is none.
 */
function familyLatest(): Plugin {
  return {
    name: 'family-latest',
    configureServer(server) {
      server.middlewares.use('/api/family-latest', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let names: string[] = [];
        try {
          names = readdirSync(DATA_DIR).filter((n) => DATA_FILE.test(n));
        } catch {
          // No data directory: treated as no file.
        }
        // '-' sorts before '.', so put the plain family.json first explicitly.
        const rank = (n: string) => (n === 'family.json' ? '' : n);
        names.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
        const newest = names.at(-1);
        if (!newest) {
          res.statusCode = 404;
          res.end('No family data file in data/');
          return;
        }
        const body = readFileSync(join(DATA_DIR, newest));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Family-File', newest);
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build also works when opened from disk.
  base: './',
  plugins: [familyLatest()],
  server: {
    // The project lives on /mnt/c; WSL2 does not deliver file-change events from the
    // Windows drive, so the dev server must poll to notice edits.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  test: {
    environment: 'node',
  },
});
