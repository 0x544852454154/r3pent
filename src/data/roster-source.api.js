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

export async function loadRoster() {
  const response = await fetch(RUNTIME.rosterUrl || '/api/roster', {
    headers: { accept: 'application/json', 'x-k': RUNTIME.token },
  })
  if (!response.ok) {
    const error = new Error(`roster unavailable (${response.status})`)
    error.status = response.status
    throw error
  }
  const roster = await response.json()
  if (!Array.isArray(roster) || roster.length === 0) throw new Error('roster malformed')
  return roster
}