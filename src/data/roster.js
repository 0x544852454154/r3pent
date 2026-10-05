/**
 * The roster is the one piece of non-public data on the page (Discord ids ->
 * handles). In production it is served by our origin at /api/roster instead of
 * being compiled into the bundle, so copying the JS does not hand over the list.
 *
 * Set VITE_BUNDLE_ROSTER=1 (or run `npm run dev`) to fall back to the copy below,
 * which is what you need when deploying to a static host with no server.
 */
export const ROLES = [['Unbothered', [['1521890728094208122', 'eunsoulja']]]]
