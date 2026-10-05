# @ repent

React port of the single-page `@ repent` site: the WebGL fluid cursor, the ASCII
art engine (enter gate, skull art, decode banner), the matrix rain and the Discord
presence roster are all components now. `legacy/` keeps the original hand-written
`index.html` + `fluid.js` for reference; nothing in the app imports from it.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # vite build + obfuscate  -> dist/
npm run verify     # assert dist/ does not leak readable source
npm run serve      # serve dist/ with the API proxy + headers (PORT=8080)
npm start          # build then serve
```

## Layout

| Path | What it is |
| --- | --- |
| `src/App.jsx` | page composition, roster loading, presence subscription |
| `src/components/` | `FluidCanvas`, `RainCanvas`, `AsciiArt`, `Banner`, `EnterGate`, `Roster`, `ProfilePopup` |
| `src/lib/asciiArt.js` | the decode/glitch/scan-sweep engine (framework-free, animates DOM rows) |
| `src/lib/fluid.js` | the GPU fluid simulation, as a factory with full `destroy()` cleanup |
| `src/lib/presence.js` | Lanyard REST snapshot + websocket deltas, reconnect and retry |
| `src/lib/ticker.jsx` | one shared `requestAnimationFrame` loop for every effect |
| `src/data/` | generated ASCII art, the roster, and the two roster-loader variants |
| `server/serve.mjs` | static server: `/api/roster`, `/api/presence/:id`, `/api/socket`, CSP |
| `scripts/obfuscate.mjs` | post-build obfuscation + gzip/brotli pre-compression |

Nothing re-renders per frame: the art engines own plain DOM `<div>` rows and
write `textContent`, React only mounts them once.

## About "protecting the source"

Straight answer: **client code cannot be protected.** Whatever the browser runs,
the browser downloads — prettified, decompressed or not. Nobody can stop someone
copying your site; you can only make it more expensive to lift and less useful
when they do. The guards in `src/lib/protect.js` are friction, not a lock, and
there is no JS that can stop a determined reader. What *is* implemented here is
real and testable:

**Build pipeline (real, measurable)**
- No source maps in production, so there is nothing to "un-minify".
- Terser minify + mangle + dead-code elimination, `console` stripping (including
  `console.error`, which used to print the name of its own env var into the bundle).
- `scripts/obfuscate.mjs` rewrites every chunk with javascript-obfuscator:
  identifiers become hex names, every string literal moves into one rotated
  base64 string array, numbers become expressions. Shaders, the art, the CDN URL
  patterns and the roster ids are not greppable. React's vendor chunk is left
  alone by default (`--all` to include it) — it is public library code.
- The HTML ships zero inline `<script>` and zero comments, so a strict CSP works
  without `unsafe-inline` and there is no note-to-visitors left in the markup.
- No endpoint path and no upstream host is a literal anywhere in the production
  JS: `/api/roster`, `/api/socket`, `/api/presence`, `site-config` and
  `lanyard.rest` are all absent, because they are injected by the server at
  request time. The dev fallbacks sit behind `import.meta.env.DEV`, which folds
  to `false` and lets terser delete them.
- `npm run verify` fails the build on: source maps, inline scripts, comments in
  any emitted chunk, an HTML comment, the endpoint paths, `lanyard.rest`,
  `getSupportedFormat`, `MANUAL_FILTERING`, the braille ramp, the roster handle
  and the Discord id. Run it after any build change.

**Server (the only part that is genuinely not public)**
- `/api/roster` — the member list is *not* in the bundle. `vite.config.js` swaps
  the roster loader at build time, so the production JS contains no Discord ids.
  It is additionally gated on a **short-lived HMAC token** that the server mints
  per HTML response and hands to the client in the config block, so the list is
  not a public `GET`: scraping means re-fetching the HTML per batch, and a leaked
  token dies within `TOKEN_TTL`. The client reloads once if its token lapses.
- `/api/presence/:id` — cached, de-duplicated, **and restricted to ids that are
  in the roster**. Before this, any numeric id was proxied, which turned your
  origin into a free "what is this Discord account doing" oracle and filled the
  cache with attacker-chosen junk. Unknown ids now answer exactly like a bad
  route, so there is no signal left to enumerate with.
- `/api/socket` — a raw websocket relay, so the upstream host is not in the
  bundle, *not in the HTML, and not in the CSP header*. The browser WebSocket API
  cannot send headers, so this route is gated on `Origin` instead, which is what
  stops another site from opening the relay on a visitor's browser.
- Rate limiting per IP, on separate buckets for the roster and the rest, with the
  buckets **swept and hard-capped** — previously every address that ever touched
  the server was a permanent `Map` entry, so rotating source addresses grew the
  process until it died.
- Strict CSP, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, HSTS (only over
  TLS), `Permissions-Policy`, COOP/CORP, immutable hashed assets, pre-compressed
  `.br`/`.gz` passthrough, `GET`/`HEAD` allowlist and `Sec-Fetch-Site` checks.
- The roster is served `private, no-store`: with `public` a shared cache would
  hand the token-gated body to the next visitor, who has no token.

**Runtime deterrences (`src/lib/protect.js`, production only)**
- Right-click, F12, `ctrl/cmd+U`, `ctrl/cmd+P`, `ctrl/cmd+shift+I/J/C`, copy/cut,
  drag and text selection are blocked, and the screen is covered while devtools
  looks docked. Opt out with `VITE_GUARD=0`.
- Deliberately *not* implemented: `debugger` traps, devtools-size polling on a
  tight loop, right-click replacement menus. They break real debugging,
  false-positive on resized windows, are defeated by one click in devtools, and
  annoy actual visitors.
- **Cannot be implemented from a page at all**, so do not expect it:
  `ctrl/cmd+shift+delete` and other clear-browsing-data shortcuts, devtools
  opened before this script ran, and the already-downloaded file sitting in
  someone's cache. A page cannot intercept its own download.

**Left readable on purpose:** object-literal keys such as `SPLAT_FORCE` and
`DENSITY_DISSIPATION`, plus the roster token's header name `x-k`. The obfuscator
renames identifiers and strings, not property names — renaming those breaks dot
access and hides nothing, since the algorithm behind them is public anyway. The
token *value* is the secret, and it is minted per response and never enters
`dist/` at all.

**The one big thing still left on the table:** the ASCII art in `src/data/art.js`
is 19 kB of your actual creative content and it *is* in the bundle. Serving it
from `/api/art` alongside the roster, the same way the roster is served, would
make a copied bundle render an empty page. It is the highest-value remaining
move and it is not implemented yet.

## Deploying

**With the included server (recommended — you get the data protection):**

```bash
npm run build
PORT=8080 npm run serve
```

Env: `PORT`, `HOST`, `PRESENCE_BASE`, `SOCKET_URL`, `PRESENCE_TTL`,
`PRESENCE_TIMEOUT`, `RATE_LIMIT`, `ROSTER_LIMIT`, `TOKEN_TTL`, `API_SECRET`,
`TRUST_PROXY`, `CSP_UPSTREAM`. Put it behind Caddy/nginx for TLS and set
`TRUST_PROXY=1` there — without it every visitor shares one rate-limit bucket
under the proxy's address. HSTS and `wss://` are both derived from the request,
so the relay works either way.

`API_SECRET` defaults to a random key per process, which invalidates all
outstanding tokens on restart. Set it to a stable secret if you run more than
one instance behind a load balancer.

**Static host (Netlify, Vercel, Pages, S3):** there is no server, so the roster
and the presence URLs have to be baked in. Build with:

```bash
VITE_BUNDLE_ROSTER=1 \
VITE_PRESENCE_BASE=https://api.lanyard.rest/v1/users \
VITE_SOCKET_URL=wss://api.lanyard.rest/socket \
npm run build
```

Minification, mangling, obfuscation and the key guard still apply; only the
server-side pieces are lost, so the roster is baked into the JS and the token
gate and presence allowlist do not exist. Copy the CSP from `server/serve.mjs`
into your host's header config, adding the upstream hosts to `connect-src` and
setting `CSP_UPSTREAM=1` on the server side if you keep using it — the browser
has to be allowed to reach the presence API directly there.

## Notes

- Presence comes from Lanyard (`api.lanyard.rest`); it needs no key for low volume.
  The status dot, activity cards and elapsed timers update live over the socket.
- `prefers-reduced-motion` skips the fluid simulation, decodes all art instantly
  and drops the enter-gate dissolve. The CRTC overlay flicker is disabled too.
- `scripts/gen-art.mjs` regenerates `src/data/art.js` from `legacy/index.html`
  (art extraction only; edit `src/data/art.js` if you change the artwork).
- The MP3 is hot-linked from `file.garden`; `BGM_SRC` lives in `src/data/art.js`
  and is only fetched after the enter click, never on load.
