import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts, which sets `root: 'web'` for the browser app. Vitest
 * would otherwise inherit that root and find no test files.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  // The web smoke test renders JSX. Vitest 4 transforms with oxc, not esbuild.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
