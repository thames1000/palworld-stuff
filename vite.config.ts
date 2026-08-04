import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Quiets one build warning from ooz-wasm.
 *
 * It ships a single Emscripten bundle for both Node and the browser. The Node half locates
 * its own directory with `new URL("./", import.meta.url)`, and Vite reports that because
 * `"./"` names a directory rather than a file, so there is nothing to resolve at build time.
 *
 * It is dead code in a browser -- `ENVIRONMENT_IS_NODE` is false, and the WASM is an inlined
 * `data:` URI, so the file-locating path it feeds is skipped entirely (`locateFile` runs only
 * `if (!isDataURI(wasmBinaryFile))`). Nothing is fetched at runtime either way.
 *
 * So this applies the suppression the warning itself suggests, to that one expression. It is
 * done here rather than through `build.rollupOptions.onwarn` because Vite logs this one
 * directly rather than through Rollup's warning channel, where `onwarn` could see it.
 *
 * Deliberately narrow: matched against that exact call in that one package, so if a future
 * ooz-wasm changes either, the warning comes back to be looked at instead of being silently
 * swallowed. The sibling `Module "module" has been externalized` warning is left alone --
 * it names the same dead branch and is equally harmless.
 *
 * Registered in `worker.plugins` as well as `plugins`, and that is the half that matters:
 * worker bundles get their own plugin pipeline, and ooz-wasm reaches the build through the
 * parser worker, so a plugin listed only in `plugins` never sees it.
 */
function quietOozWasmNodeBranch(): Plugin {
  const call = 'new URL("./",import.meta.url)';
  return {
    name: 'palforge:quiet-ooz-wasm-node-branch',
    // Must run before Vite's own import.meta.url handling, which is what warns.
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('ooz-wasm') || !code.includes(call)) return null;
      return code.replaceAll(call, 'new URL(/* @vite-ignore */ "./",import.meta.url)');
    },
  };
}

export default defineConfig({
  root: 'web',
  // Relative base so the built site works from a subpath (GitHub Pages project sites)
  // as well as from a domain root.
  base: './',
  plugins: [react(), tailwindcss(), quietOozWasmNodeBranch()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  worker: {
    // The worker imports the core parser as ES modules; the classic worker format cannot.
    format: 'es',
    plugins: () => [quietOozWasmNodeBranch()],
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    // ooz-wasm uses top-level await to instantiate its embedded WASM module.
    target: 'es2022',
  },
});
