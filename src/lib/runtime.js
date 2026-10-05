/**
 * Runtime configuration.
 *
 * Priority: the server-injected
 * `<script type="application/json" id="site-config">` block (see
 * `server/serve.mjs`) always wins, so a proxied deploy carries no endpoint path
 * and no upstream host in the shipped JS.
 *
 * The fallbacks below matter for the static-host deploy with no server, where
 * nothing gets injected. `VITE_PRESENCE_BASE` / `VITE_SOCKET_URL` are the
 * explicit opt-in for that case; the bare Lanyard URLs are dev-only.
 * `import.meta.env.DEV` folds to `false` in a production build, so terser drops
 * the last two branches and the host strings with them - `npm run verify` fails
 * the build if any survive.
 *
 * Leaving all three empty is a valid (quiet) configuration: the roster still
 * loads, avatars fall back to the generic Discord one and decorations are hidden.
 */
const DEFAULTS = {
  presenceBase:
    import.meta.env.VITE_PRESENCE_BASE ||
    (import.meta.env.DEV ? 'https://api.lanyard.rest/v1/users' : ''),
  socketUrl:
    import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'wss://api.lanyard.rest/socket' : ''),
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