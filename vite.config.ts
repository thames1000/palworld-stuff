import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  // Relative base so the built site works from a subpath (GitHub Pages project sites)
  // as well as from a domain root.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  worker: {
    // The worker imports the core parser as ES modules; the classic worker format cannot.
    format: 'es',
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    // ooz-wasm uses top-level await to instantiate its embedded WASM module.
    target: 'es2022',
  },
});
