/**
 * Post-build protection pass.
 *
 * Rewrites every emitted JS chunk with javascript-obfuscator so that neither the
 * control flow, the shader source, the Discord CDN patterns nor the roster data
 * can be read (or grepped) out of dist/, and pre-compresses the result because
 * obfuscation costs bytes.
 *
 * The React vendor chunk is left alone by default: it is public library code, so
 * obfuscating it protects nothing and only slows the parse. Use `--all` if you
 * want it obfuscated too.
 *
 * Profiles (measured on this project's own chunk):
 *   default  ~1.9x raw / 31 kB gzip - every string literal encoded
 *   --max    ~2.6x raw / 44 kB gzip - adds splitStrings + numbersToExpressions
 *
 * Usage: node scripts/obfuscate.mjs [--all] [--max] [--no-compress]
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import obfuscator from 'javascript-obfuscator'

const { obfuscate } = obfuscator

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = resolve(root, 'dist', 'assets')
const args = process.argv.slice(2)
const includeVendor = args.includes('--all')
const compress = !args.includes('--no-compress')
const max = args.includes('--max')

const options = {
  compact: true,
  target: 'browser',
  // identifiers become short hex names, so nothing reads like source
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  // every string literal moves into one rotated, base64-encoded array
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'variable',
  stringArrayRotate: true,
  // roughly doubles the compressed size again; opt in with --max
  ...(max ? { splitStrings: true, splitStringsChunkLength: 8, numbersToExpressions: true } : null),
  // deliberately off: they break legitimate debugging, are defeated by a single
  // click in devtools, and cost real load time
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  selfDefending: false,
  unicodeEscapeSequence: false,
}

const files = (await readdir(assetsDir)).filter((file) => file.endsWith('.js'))
let obfuscated = 0
let skipped = 0
let rawTotal = 0
let gzTotal = 0
let brTotal = 0

for (const file of files) {
  if (!includeVendor && file.startsWith('vendor.')) {
    skipped++
    continue
  }
  const target = join(assetsDir, file)
  const source = await readFile(target, 'utf8')
  let code
  try {
    code = obfuscate(source, options).getObfuscatedCode()
  } catch (error) {
    console.error(`[obfuscate] failed on ${file}, leaving it minified:`, error.message)
    continue
  }
  await writeFile(target, code)
  obfuscated++

  const raw = Buffer.from(code, 'utf8')
  rawTotal += raw.length
  if (!compress) continue
  const gz = gzipSync(raw, { level: 9 })
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  })
  await writeFile(`${target}.gz`, gz)
  await writeFile(`${target}.br`, br)
  gzTotal += gz.length
  brTotal += br.length
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
console.log(
  `[obfuscate] ${obfuscated} chunk(s) obfuscated, ${skipped} skipped (vendor). ` +
    `raw ${kb(rawTotal)} / gzip ${kb(gzTotal)} / brotli ${kb(brTotal)}`,
)
