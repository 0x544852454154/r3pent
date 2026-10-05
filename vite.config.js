import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 6. The roster (Discord ids -> handles) is served by our own origin at
 *    /api/roster instead of being compiled in. The loader is swapped at config
 *    time, so the production bundle contains no member list at all; only a
 *    static host (VITE_BUNDLE_ROSTER=1) falls back to the inlined copy.
 */
const ROSTER_LOADER_BUNDLED = fileURLToPath(
  new URL('./src/data/roster-source.bundle.js', import.meta.url),
)
const ROSTER_LOADER_API = fileURLToPath(
  new URL('./src/data/roster-source.api.js', import.meta.url),
)

/**
 * Production hardening notes
 * --------------------------
 * Client code is never secret: anything the browser executes, the browser has
 * downloaded. What we CAN do is make the shipped artifact expensive to read and
 * worthless to lift wholesale:
 *
 *   1. No source maps in the production build, so the original JSX/logic is not
 *      sitting next to the bundle waiting to be prettified.
 *   2. Terser: minify + mangle + dead-code removal + console stripping.
 *   3. No inline `<script>` in the emitted HTML, so a strict CSP is possible
 *      without `unsafe-inline` (see server/serve.mjs).
 *   4. `scripts/obfuscate.mjs` runs after the bundle and rewrites every emitted
 *      JS chunk with javascript-obfuscator (identifier renaming + encoded string
 *      array), so neither the logic nor the user-facing strings can be grepped
 *      out of dist/.
 *   5. Hashed, immutable asset filenames kill stale-copy hotlinking.
 *   6. See ROSTER_LOADER_* below: the roster never reaches the bundle.
 */
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'

  const inlineRoster = !isProd || process.env.VITE_BUNDLE_ROSTER === '1'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@data/roster-source': inlineRoster ? ROSTER_LOADER_BUNDLED : ROSTER_LOADER_API,
      },
    },
    define: {
      __PROD__: JSON.stringify(isProd),
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsDir: 'assets',
      // 1. No sourcemaps.
      sourcemap: false,
      // Keeps the emitted HTML free of inline scripts (see 3).
      modulePreload: false,
      cssMinify: true,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // 5. Hashed, immutable names.
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
              return 'vendor'
            }
          },
        },
      },
      // 2. Terser.
      minify: isProd ? 'terser' : false,
      terserOptions: isProd
        ? {
            ecma: 2020,
            module: true,
            compress: {
              passes: 3,
              pure_getters: true,
              unsafe_arrows: true,
              // error included: a failing handler used to name its own env vars
              drop_console: ['log', 'info', 'debug', 'warn', 'table', 'dir', 'error'],
              drop_debugger: true,
            },
            mangle: true,
            format: {
              comments: false,
              ascii_only: true,
            },
          }
        : undefined,
    },
  }
})
