/**
 * Roster loader: variant B - data fetched from our own origin.
 *
 * This is what production builds use (see vite.config.js), so the Discord ids
 * are only ever returned by /api/roster and never sit in the bundle.
 *
 * `RUNTIME.rosterUrl` is injected by server/serve.mjs. When that block is absent
 * - a static host, or `vite preview`, which serves dist/ without running the
 * server - we fall back to the relative path, so the page still works against
 * anything that reverse-proxies /api back to us. Obscuring a same-origin path is
 * worth nothing anyway: it is in the network tab for anyone who looks, and the
 * token gate below is the actual control.
 */
import { RUNTIME } from '../lib/runtime.js'

/**
 * The roster lives in the server process (`src/data/roster.js`), never in the
 * bundle, so "no API here" is the single most common way to run this site wrong.
 * Say so instead of surfacing a bare status code.
 */
function describe(response) {
  if (response.status === 404 || response.status === 405) {
    return (
      `roster unavailable (${response.status}) - nothing is serving /api here. ` +
      'Run `npm run serve` (not a plain static server), or build for a static ' +
      'host with `npm run build:static`'
    )
  }
  if (response.status === 403) {
    return 'roster unavailable (403) - access token rejected, try reloading'
  }
  if (response.status === 429) {
    return 'roster unavailable (429) - too many requests, slow down'
  }
  return `roster unavailable (${response.status})`
}

export async function loadRoster() {
  let response
  try {
    response = await fetch(RUNTIME.rosterUrl || '/api/roster', {
      headers: { accept: 'application/json', 'x-k': RUNTIME.token },
    })
  } catch (cause) {
    const error = new Error(`roster unreachable - ${cause.message}`)
    error.status = 0
    throw error
  }

  if (!response.ok) {
    const error = new Error(describe(response))
    error.status = response.status
    throw error
  }

  // a static host that answers every path with index.html gets here with 200 and
  // HTML, which is the same class of mistake as a 404
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    const error = new Error(
      'roster unavailable (not JSON) - /api/roster is serving the page instead ' +
        'of the API. Run `npm run serve`, or build with `npm run build:static`',
    )
    error.status = response.status
    throw error
  }

  const roster = await response.json()
  if (!Array.isArray(roster) || roster.length === 0) throw new Error('roster malformed')
  return roster
}