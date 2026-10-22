import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { newestDataFile } from './scripts/data-file.ts';

const DATA_DIR = join(import.meta.dirname, 'data');

/**
 * Dev server only: GET /api/family-latest returns the newest data file in data/ (`newestDataFile`),
 * with its name in the X-Family-File header. 404 when there is none.
 */
function familyLatest(): Plugin {
  return {
    name: 'family-latest',
    configureServer(server) {
      server.middlewares.use('/api/family-latest', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const newest = newestDataFile(DATA_DIR);
        if (!newest) {
          res.statusCode = 404;
          res.end('No family data file in data/');
          return;
        }
        const body = readFileSync(newest);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Family-File', basename(newest));
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
  };
}

/** Build only: drops the HTML comments (notes for developers) from the built page. */
function stripHtmlComments(): Plugin {
  return {
    name: 'strip-html-comments',
    apply: 'build',
    transformIndexHtml: (html) => html.replace(/\s*<!--[\s\S]*?-->/g, ''),
  };
}

export default defineConfig({
  // Relative asset paths so the build also works when opened from disk.
  base: './',
  plugins: [familyLatest(), stripHtmlComments()],
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
