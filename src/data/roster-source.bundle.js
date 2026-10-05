/**
 * Roster loader: variant A — data compiled into the bundle.
 *
 * Used by `npm run dev` and by production builds run with VITE_BUNDLE_ROSTER=1
 * (static hosting with no server). vite.config.js points `@data/roster-source`
 * at this file for those cases, so the ids never reach the shipped artifact when
 * we serve the site ourselves.
 */
import { ROLES } from './roster.js'

export async function loadRoster() {
  return ROLES
}
