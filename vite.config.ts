import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build also works when opened from disk.
  base: './',
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
