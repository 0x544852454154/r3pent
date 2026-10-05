/**
 * Runtime configuration.
 *
 * Every value is supplied by a
 * `<script type="application/json" id="site-config">` data block that
 * `server/serve.mjs` injects into index.html per request. Nothing is hardcoded,
 * so the production bundle contains no endpoint path and no upstream host: if
 * you have the JS you still do not know where to ask, and the roster answer is
 * additionally gated on a short-lived token from the same block.
 *
 * The values below are the dev-only fallbacks. `import.meta.env.DEV` folds to
 * `false` in a production build, so terser deletes the branches (and the host
 * strings) entirely - `npm run verify` fails the build if any survive.
 */
const DEFAULTS = {
  presenceBase: import.meta.env.DEV ? 'https://api.lanyard.rest/v1/users' : '',
  socketUrl: import.meta.env.DEV ? 'wss://api.lanyard.rest/socket' : '',
  rosterUrl: '',
  token: '',
}

function injected() {
  if (typeof document === 'undefined') return {}
  const node = document.getElementById('site-config')
  if (!node || !node.textContent) return {}
  try {
    const parsed = JSON.parse(node.textContent)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const RUNTIME = { ...DEFAULTS, ...injected() }