/**
 * Static-host build with portable env handling — used by the `build:vercel`
 * script so platform builds (Vercel, Netlify, Cloudflare Pages) get the static
 * variant even when their shell can't parse the inline env assignments in the
 * `build:static` script (Vercel's default is sh, where `VAR=x cmd` is valid, but
 * npm runs scripts with cmd on Windows CI and some wrappers mangle it).
 *
 * Sets the three variables, runs the same pipeline as build:static, then
 * verifies that the roster really ended up in the bundle — if the alias didn't
 * flip, dist/ would fetch /api/roster and 404 on a static host, which is the
 * failure this script exists to prevent.
 */
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const env = {
  ...process.env,
  VITE_BUNDLE_ROSTER: '1',
  VITE_PRESENCE_BASE: process.env.VITE_PRESENCE_BASE || 'https://api.lanyard.rest/v1/users',
  VITE_SOCKET_URL: process.env.VITE_SOCKET_URL || 'wss://api.lanyard.rest/socket',
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })
}

// The guard must run BEFORE obfuscation: the obfuscator folds every string
// literal into an RC4/base64 string array, so a plain `includes` on the final
// chunk cannot find the roster id. On the raw Terser output it is a plain
// substring.
async function assertRosterBundled() {
  const assetsDir = join(root, 'dist', 'assets')
  const files = (await readdir(assetsDir)).filter((file) => file.endsWith('.js'))
  const roster = await readFile(join(root, 'src', 'data', 'roster.js'), 'utf8')
  const id = roster.match(/\d{17,20}/)?.[0]
  if (!id) {
    console.error('[build-static] could not find a Discord id in src/data/roster.js to check for')
    process.exit(1)
  }
  const found = await Promise.all(
    files.map(async (file) => (await readFile(join(assetsDir, file), 'utf8')).includes(id)),
  )
  if (!found.some(Boolean)) {
    console.error(
      '[build-static] FAILED: the roster is not in dist/ - vite used the API loader. ' +
        'The deployed site would 404. Check that VITE_BUNDLE_ROSTER=1 is set.',
    )
    process.exit(1)
  }
  console.log('[build-static] ok: roster is bundled, presence endpoints point at lanyard')
}

run('npx', ['vite', 'build'])
await assertRosterBundled()
run('node', ['scripts/obfuscate.mjs'])
run('node', ['scripts/verify-build.mjs'])
