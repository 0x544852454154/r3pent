/**
 * Static server for dist/ with the bits a static host cannot give us.
 *
 *   1. /api/roster        the member list, kept out of the bundle and gated on a
 *                         short-lived token minted per HTML response
 *   2. /api/presence/:id  cached + de-duplicated proxy, restricted to ids that
 *                         are actually in the roster, so this origin can never be
 *                         used as a Discord-id oracle
 *   3. /api/socket        websocket relay, origin-checked, so the upstream host
 *                         is not in the bundle, the HTML, or reachable cross-site
 *   4. strict CSP, method allowlist, Sec-Fetch-Site checks and pre-compressed
 *                         .br/.gz passthrough
 *
 * Zero dependencies. Env:
 *   PORT            default 8080
 *   HOST            default 0.0.0.0
 *   PRESENCE_BASE   upstream REST  (default https://api.lanyard.rest/v1/users)
 *   PRESENCE_TTL    cache window ms (default 5000)
 *   RATE_LIMIT      requests per IP per minute for /api (default 120)
 *   ROSTER_LIMIT    requests per IP per minute for /api/roster (default 20)
 *   TOKEN_TTL       roster token lifetime ms (default 900000)
 *   API_SECRET      token signing key (default: random per process)
 *   TRUST_PROXY     honour X-Forwarded-* (only enable behind your own proxy)
 *   CSP_UPSTREAM    allow the browser to connect to the upstream hosts directly
 *                   (static-host deploys only; default: same-origin only)
 */
import { createServer } from 'node:http'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES } from '../src/data/roster.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

const PORT = Number(process.env.PORT || 8080)
const HOST = process.env.HOST || '0.0.0.0'
const PRESENCE_BASE = process.env.PRESENCE_BASE || 'https://api.lanyard.rest/v1/users'
const PRESENCE_TTL = Number(process.env.PRESENCE_TTL || 5000)
const PRESENCE_TIMEOUT = Number(process.env.PRESENCE_TIMEOUT || 5000)
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 120)
const ROSTER_LIMIT = Number(process.env.ROSTER_LIMIT || 20)
const TOKEN_TTL = Number(process.env.TOKEN_TTL || 900000)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const CSP_UPSTREAM = process.env.CSP_UPSTREAM === '1'
const SECRET = process.env.API_SECRET ? Buffer.from(process.env.API_SECRET) : randomBytes(32)

const SOCKET_URL = process.env.SOCKET_URL || 'wss://api.lanyard.rest/socket'
const SOCKET_PATH = '/api/socket'
const ROSTER_PATH = '/api/roster'
const PRESENCE_PREFIX = '/api/presence/'
const RATE_WINDOW_MS = 60000
const MAX_BUCKETS = 50000
const MAX_CACHED = 256

const MEMBER_IDS = new Set(ROLES.flatMap(([, people]) => people.map(([id]) => id)))

/**
 * Both presence endpoints live on our origin, so the upstream host is never
 * written into anything the browser can read - not the bundle, not the HTML.
 * The values are per-request because the socket URL has to carry the request's
 * own scheme and host, and the roster token has to be fresh.
 */
function requestHost(req) {
  const raw = (TRUST_PROXY ? req.headers['x-forwarded-host'] : null) || req.headers.host || ''
  const value = String(raw).split(',')[0].trim()
  // the host lands in a URL and in JSON we inject into HTML, so allowlist it
  return /^[A-Za-z0-9.\-]{1,253}(?::\d{1,5})?$/.test(value) ||
    /^\[[0-9A-Fa-f:]{1,45}\](?::\d{1,5})?$/.test(value)
    ? value
    : 'localhost'
}

function requestSecure(req) {
  if (req.socket.encrypted) return true
  if (!TRUST_PROXY) return false
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
}

function sign(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 32)
}

function issueToken() {
  const body = Buffer.from(String(Date.now() + TOKEN_TTL), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

/**
 * Bearer token for the roster/presence routes. It is a bearer credential: it
 * lives in the injected data block, so anyone who loads the page has it. What it
 * buys is that the list is no longer a public GET - scraping it means fetching
 * the HTML (rate limited) per batch instead of looping a bare URL forever, and a
 * leaked token dies within TOKEN_TTL.
 */
function tokenValid(header) {
  const token = Array.isArray(header) ? header[0] : header
  if (typeof token !== 'string' || token.length < 8 || token.length > 128) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const body = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  const expires = Number(Buffer.from(body, 'base64url').toString('utf8'))
  return Number.isFinite(expires) && expires > Date.now()
}

function configBlock(req) {
  const config = {
    presenceBase: PRESENCE_PREFIX.replace(/\/$/, ''),
    socketUrl: `${requestSecure(req) ? 'wss' : 'ws'}://${requestHost(req)}${SOCKET_PATH}`,
    rosterUrl: ROSTER_PATH,
    token: issueToken(),
  }
  // `<` cannot appear unescaped in an HTML raw-text element
  const json = JSON.stringify(config).replace(/</g, '\\u003c')
  return `<script type="application/json" id="site-config">${json}</script>`
}

const UPSTREAM_HOSTS = [
  ...new Set(
    [PRESENCE_BASE, SOCKET_URL].flatMap((url) => {
      try {
        return [new URL(url).host]
      } catch {
        return []
      }
    }),
  ),
]

/**
 * The upstream presence hosts are deliberately NOT listed: the browser only ever
 * talks to our own origin, and a CSP header is a response header, so listing them
 * would hand the upstream host to anyone reading one. Set CSP_UPSTREAM=1 only if
 * you deploy to a static host where the browser really does connect directly.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // the ascii art is styled, not scripted; inline styles only carry the two CSS
  // custom properties the canvas sizing writes
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net https://i.scdn.co",
  "media-src 'self' https://file.garden",
  CSP_UPSTREAM
    ? `connect-src 'self' ${UPSTREAM_HOSTS.flatMap((host) => [`https://${host}`, `wss://${host}`]).join(' ')}`
    : "connect-src 'self'",
  'font-src *',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const cache = new Map()
const inFlight = new Map()
const hits = new Map()
const rosterHits = new Map()

/**
 * Buckets were previously kept forever, so every address that ever touched the
 * server was a permanent Map entry: a slow, unbounded memory leak that only
 * needed a spoofed or rotating source address. Buckets are now swept, and the
 * maps are hard-capped so a burst of new addresses cannot still grow them.
 */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of hits) if (now - entry.start > RATE_WINDOW_MS) hits.delete(key)
  for (const [key, entry] of rosterHits) if (now - entry.start > RATE_WINDOW_MS) rosterHits.delete(key)
  for (const [key, entry] of cache) if (now - entry.at > PRESENCE_TTL) cache.delete(key)
}, 30000)
sweeper.unref()

function evictOldest(map, limit) {
  if (map.size <= limit) return
  let drop = map.size - Math.floor(limit / 2)
  for (const key of map.keys()) {
    if (drop-- <= 0) break
    map.delete(key)
  }
}

function rateLimited(map, ip, limit) {
  const now = Date.now()
  const entry = map.get(ip)
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    evictOldest(map, MAX_BUCKETS)
    map.set(ip, { start: now, count: 1 })
    return false
  }
  entry.count++
  return entry.count > limit
}

function securityHeaders(secure) {
  const headers = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'x-download-options': 'noopen',
    'permissions-policy':
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  }
  // only over TLS, otherwise an http-only check would pin visitors to https
  if (secure) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  return headers
}

function sendJson(res, req, status, body, extra = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...securityHeaders(requestSecure(req)),
    ...extra,
  }
  if (req.method === 'HEAD') return res.writeHead(status, headers).end()
  const payload = JSON.stringify(body)
  res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

/**
 * Browser fetches carry Sec-Fetch-Site; anything cross-site (an `<img>`, a
 * `<script>`, a form post from another site) is rejected before any work. The
 * token covers the clients that send no fetch metadata at all.
 */
function fetchBlocked(req) {
  const site = req.headers['sec-fetch-site']
  return site != null && site !== 'same-origin' && site !== 'same-site' && site !== 'none'
}

async function serveFile(res, req, path) {
  const extension = extname(path)
  const type = TYPES[extension] || 'application/octet-stream'
  const headers = { ...securityHeaders(requestSecure(req)) }
  const accepts = String(req.headers['accept-encoding'] || '')

  if (path.includes('/assets/') || path.endsWith('.woff2')) {
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = 'no-cache'
  }

  // pre-compressed variants written by scripts/obfuscate.mjs
  const variant = accepts.includes('br') ? 'br' : accepts.includes('gzip') ? 'gz' : null
  if (variant && (extension === '.js' || extension === '.css')) {
    try {
      const body = await readFile(`${path}.${variant}`)
      res.writeHead(200, {
        ...headers,
        'content-type': type,
        'content-encoding': variant === 'br' ? 'br' : 'gzip',
        'content-length': body.length,
        vary: 'Accept-Encoding',
      })
      res.end(body)
      return
    } catch {
      // no pre-compressed copy, fall through to the plain file
    }
  }

  const body = await readFile(path)
  res.writeHead(200, { ...headers, 'content-type': type, 'content-length': body.length })
  res.end(body)
}

async function presence(id) {
  const now = Date.now()
  const hit = cache.get(id)
  if (hit && now - hit.at < PRESENCE_TTL) return hit.value
  if (inFlight.has(id)) return inFlight.get(id)

  const request = fetch(`${PRESENCE_BASE}/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PRESENCE_TIMEOUT),
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const value = payload && payload.success && payload.data ? payload.data : null
      evictOldest(cache, MAX_CACHED)
      cache.set(id, { at: Date.now(), value })
      return value
    })
    .catch(() => null)
    .finally(() => inFlight.delete(id))

  inFlight.set(id, request)
  return request
}

function handleApi(req, res, url, ip) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, req, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
  }
  if (fetchBlocked(req)) return sendJson(res, req, 403, { error: 'forbidden' })

  // some proxies normalise /api/roster to /api/roster/; do not 404 on that
  const route = url.pathname.replace(/\/+$/, '') || '/'

  if (route === ROSTER_PATH) {
    if (rateLimited(rosterHits, ip, ROSTER_LIMIT)) {
      return sendJson(res, req, 429, { error: 'rate limited' })
    }
    if (!tokenValid(req.headers['x-k'])) return sendJson(res, req, 403, { error: 'forbidden' })
    // must never be `public`: a shared cache would hand the token-gated body to
    // the next visitor who has no token
    return sendJson(res, req, 200, ROLES, { 'cache-control': 'private, no-store' })
  }

  const presenceBase = PRESENCE_PREFIX.replace(/\/$/, '')
  if (route.startsWith(presenceBase)) {
    if (rateLimited(hits, ip, RATE_LIMIT)) return sendJson(res, req, 429, { error: 'rate limited' })
    if (!tokenValid(req.headers['x-k'])) return sendJson(res, req, 403, { error: 'forbidden' })
    const id = route.slice(presenceBase.length).replace(/^\//, '')
    // only ids we already know: an unscoped numeric id turns this origin into a
    // free "what is this Discord account doing" oracle and fills the cache with
    // junk. Unknown ids answer exactly like a bad route, so there is no signal
    // to enumerate with.
    if (!/^\d+$/.test(id) || !MEMBER_IDS.has(id)) {
      return sendJson(res, req, 404, { error: 'not found' })
    }
    return presence(id).then((value) =>
      sendJson(res, req, value ? 200 : 404, value || { error: 'unavailable' }),
    )
  }

  return sendJson(res, req, 404, { error: 'not found' })
}

const server = createServer(async (req, res) => {
  const ip =
    (TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') ||
    req.socket.remoteAddress ||
    'unknown'

  // Everything is inside the try. `new URL` used to sit above it, so a single
  // malformed request line or Host header threw outside any handler: the
  // rejection was unhandled and Node exited, i.e. one crafted request from
  // anyone took the whole site down. The base comes from the validated host, so
  // the parse itself cannot fail on attacker input.
  try {
    const url = new URL(req.url || '/', `http://${requestHost(req)}`)

    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, ip)

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, req, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname
    const path = join(dist, normalize(requested).replace(/^(\.\.[/\\])+/, ''))
    if (path !== dist && !path.startsWith(`${dist}/`)) {
      return sendJson(res, req, 403, { error: 'forbidden' })
    }

    let target = path
    let info = await stat(target).catch(() => null)
    if (info && info.isDirectory()) {
      target = join(target, 'index.html')
      info = await stat(target).catch(() => null)
    }

    if (target.endsWith('index.html')) {
      const html = await readFile(target, 'utf8')
      const block = configBlock(req)
      const injected = html.includes('</head>')
        ? html.replace('</head>', `  ${block}\n  </head>`)
        : block + html
      const body = Buffer.from(injected, 'utf8')
      res.writeHead(200, {
        ...securityHeaders(requestSecure(req)),
        'content-type': TYPES['.html'],
        'cache-control': 'no-cache',
        'content-length': body.length,
      })
      return res.end(req.method === 'HEAD' ? undefined : body)
    }

    if (!info) return sendJson(res, req, 404, { error: 'not found' })
    return await serveFile(res, req, target)
  } catch (error) {
    if (error && error.code === 'ENOENT') return sendJson(res, req, 404, { error: 'not found' })
    if (error && error.code === 'ERR_INVALID_URL') {
      return sendJson(res, req, 400, { error: 'bad request' })
    }
    console.error('[serve]', error)
    if (!res.headersSent) sendJson(res, req, 500, { error: 'server error' })
  }
})

/**
 * Websocket relay: the client talks to /api/socket on our own origin and we pipe
 * the frames straight through to the upstream socket. Keeps the upstream URL out
 * of the HTML, gives us one place to rate limit the stream, and - because the
 * browser WebSocket API cannot send headers, so the roster token is not
 * available here - gates on Origin instead, which is what stops another site
 * from opening the relay on a visitor's browser (cross-site WebSocket hijacking).
 */
server.on('upgrade', (req, socket, head) => {
  const fail = () => socket.destroy()
  let url
  try {
    url = new URL(req.url || '/', `http://${requestHost(req)}`)
  } catch {
    return fail()
  }
  if ((req.method || 'GET') !== 'GET') return fail()
  if (url.pathname !== SOCKET_PATH) return fail()
  if (rateLimited(hits, req.socket.remoteAddress || 'unknown', RATE_LIMIT)) return fail()

  const origin = req.headers.origin
  if (origin) {
    let parsed = null
    try {
      parsed = new URL(origin)
    } catch {
      return fail()
    }
    if (parsed.host !== requestHost(req)) return fail()
  }

  const target = (() => {
    try {
      return new URL(SOCKET_URL)
    } catch {
      return null
    }
  })()
  if (!target) return fail()

  const secure = target.protocol === 'wss:'
  const upstream = (secure ? tlsConnect : netConnect)(
    {
      host: target.hostname,
      port: target.port || (secure ? 443 : 80),
      servername: target.hostname,
    },
    () => {
      const head2 = [`GET ${target.pathname}${url.search} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]
        const value = req.rawHeaders[i + 1]
        if (name.toLowerCase() === 'host') {
          head2.push(`Host: ${target.host}`)
          continue
        }
        // hop-by-hop framing headers are re-set below; everything the WebSocket
        // handshake needs (Sec-WebSocket-Key, -Version, -Protocol, -Extensions)
        // MUST be forwarded or the upstream answers a plain GET with 400
        if (['connection', 'upgrade'].includes(name.toLowerCase())) {
          continue
        }
        if (name.toLowerCase() === 'origin') {
          head2.push(`Origin: ${target.origin}`)
          continue
        }
        head2.push(`${name}: ${value}`)
      }
      head2.push('Connection: Upgrade', 'Upgrade: websocket')
      upstream.write(`${head2.join('\r\n')}\r\n\r\n`)
      if (head && head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    },
  )

  const kill = () => {
    socket.destroy()
    upstream.destroy()
  }
  upstream.on('error', kill)
  socket.on('error', kill)
  upstream.on('close', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
})

server.listen(PORT, HOST, () => {
  console.log(`[serve] dist/ on http://${HOST}:${PORT}`)
  console.log(`[serve] roster + presence proxied, upstream ${PRESENCE_BASE}`)
  console.log(`[serve] token TTL ${TOKEN_TTL}ms, roster limit ${ROSTER_LIMIT}/min per IP`)
})