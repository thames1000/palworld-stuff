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
  // Two warnings from ooz-wasm are expected and are not suppressed, because silencing them
  // means silencing the same warning if it ever comes from our own code:
  //
  //   new URL("./", import.meta.url) doesn't exist at build time
  //   Module "module" has been externalized for browser compatibility
  //
  // Both come from the `ENVIRONMENT_IS_NODE` branch of its Emscripten wrapper, which is dead
  // code in a browser. Nothing is fetched at runtime either way: its WASM is a base64
  // `data:` URI, and the file-locating path it guards runs only when that is *not* the case.
});
