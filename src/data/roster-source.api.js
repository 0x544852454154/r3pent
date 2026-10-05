/**
 * Roster loader: variant B - data fetched from our own origin.
 *
 * This is what production builds use (see vite.config.js). The path comes from
 * the server-injected config block, and the request carries the token that the
 * same block mints, so neither the path nor the Discord ids are in the bundle.
 */
import { RUNTIME } from '../lib/runtime.js'

export async function loadRoster() {
  if (!RUNTIME.rosterUrl) throw new Error('no roster endpoint configured')
  const response = await fetch(RUNTIME.rosterUrl, {
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