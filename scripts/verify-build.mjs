/**
 * Post-build sanity check on what actually ships.
 *
 * Every entry below is something you could read or grep for in dist/ right now if
 * the hardening were not working, so this doubles as a regression test.
 *
 *   node scripts/verify-build.mjs   (or: npm run verify)
 */
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const assetsDir = join(dist, 'assets')

/** Must not be greppable in the shipped bundle. */
const FORBIDDEN = [
  ['source map reference', 'sourceMappingURL'],
  ['function name', 'getSupportedFormat'],
  ['function name', 'createDoubleFBO'],
  ['shader keyword', 'MANUAL_FILTERING'],
  ['lanyard api host', 'lanyard.rest'],
  ['discord cdn', 'discordapp.com'],
  ['ascii art glyph ramp', '\u2801'],
  ['banner glyphs', '\u2591\u2592\u2593\u2588'],
  ['roster handle', 'eunsoulja'],
  ['discord user id', '1521890728094208122'],
  // the endpoints and the config-block id are deliberately not literals
  ['roster endpoint', 'api/roster'],
  ['socket endpoint', 'api/socket'],
  ['presence endpoint', 'api/presence'],
  ['config block id', 'site-config'],
]

/**
 * Present by design: the obfuscator renames identifiers and encodes strings, but
 * it does not rename object-literal keys (renaming them breaks dot access and
 * buys nothing - these are configuration labels, and the algorithm behind them is
 * public anyway).
 *
 * `x-k` is in this list on purpose. It is the roster token's header *name*; the
 * token *value* is minted per response by the server and never enters the
 * bundle, so the name is not a secret - only the value is.
 */
const KNOWN = [
  'SPLAT_FORCE',
  'DENSITY_DISSIPATION',
  'PRESSURE_ITERATIONS',
  "'x-k'",
]

const failures = []

const files = await readdir(assetsDir)
const scripts = files.filter((file) => file.endsWith('.js'))
const styles = files.filter((file) => file.endsWith('.css'))

if (files.some((file) => file.endsWith('.map'))) failures.push('sourcemap files are present in dist/')

const html = await readFile(join(dist, 'index.html'), 'utf8')
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
if (inlineScripts.length > 0) {
  failures.push(`index.html contains ${inlineScripts.length} inline <script> block(s)`)
}

// comments and notes: terser strips JS, but the emitted HTML is copied verbatim
if (/<!--[\s\S]*?-->/.test(html)) {
  failures.push('index.html ships an HTML comment')
}
if (/<title>.*(no licence|not for redistribution|ask before copying)/i.test(html)) {
  failures.push('index.html ships a note aimed at visitors')
}

/**
 * Anything comment-shaped that survives here would be a note about the code
 * shipped to the browser. RegExp literals in minified output can look like
 * comments, so only real block/line comments are counted.
 */
function commentHits(code, kind) {
  const pattern = kind === 'css' ? /\/\*[\s\S]*?\*\//g : /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n'"`\\]*$/gm
  return (code.match(pattern) || []).length
}

const corpus = []
for (const file of [...scripts, ...styles]) {
  corpus.push([file, await readFile(join(assetsDir, file), 'utf8')])
}

for (const [label, needle] of FORBIDDEN) {
  const hits = corpus.filter(([, code]) => code.includes(needle)).map(([file]) => file)
  if (hits.length > 0) failures.push(`readable ${label} in ${hits.join(', ')}`)
}

for (const [file, code] of corpus) {
  const count = commentHits(code, file.endsWith('.css') ? 'css' : 'js')
  if (count > 0) failures.push(`${file} ships ${count} comment(s)`)
}

console.log('[verify] emitted chunks:')
for (const [file, code] of corpus) console.log(`         ${file}: ${(code.length / 1024).toFixed(1)} kB raw`)

const known = KNOWN.filter((needle) => corpus.some(([, code]) => code.includes(needle)))
if (known.length > 0) {
  console.log(`[verify] config keys left readable by design: ${known.join(', ')}`)
}

if (failures.length > 0) {
  console.error('\n[verify] FAILED:')
  for (const failure of failures) console.error(`         - ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    '[verify] ok: no sourcemaps, no inline scripts, no comments, no endpoints, no readable source strings',
  )
}