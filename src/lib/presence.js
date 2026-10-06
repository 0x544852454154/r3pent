/**
 * Lanyard presence feed (REST snapshot + websocket deltas).
 *
 * `restBase` / `socketUrl` come from the server-injected config block when
 * server/serve.mjs is serving the page, which keeps the upstream host out of the
 * bundle. When that block is absent - a static host, or `vite preview` - we fall
 * back to our own origin, so a deployment that reverse-proxies /api still gets
 * avatars, decorations and live activity. VITE_PRESENCE_BASE / VITE_SOCKET_URL
 * remain the escape hatch for a genuinely static host with no /api at all.
 */
const RECONNECT_MS = 3000
const MAX_ATTEMPTS = 3

function sameOriginSocket() {
  if (typeof location === 'undefined') return ''
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/socket`
}

export function subscribePresence(ids, options = {}) {
  const { onUpdate, onError, token = '' } = options
  const restBase = options.restBase || '/api/presence'
  const endpoint = options.socketUrl || sameOriginSocket()
  const headers = { accept: 'application/json', 'x-k': token }
  const timers = new Set()
  let socket = null
  let heartbeat = null
  let reconnect = null
  let stopped = false
  const inFlight = new Set()

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!stopped) fn()
    }, ms)
    timers.add(id)
  }

  const load = (id, attempt = 0) => {
    if (stopped || inFlight.has(id)) return
    inFlight.add(id)
    fetch(`${restBase}/${id}`, { headers })
      .then((response) => response.json())
      .then((payload) => {
        inFlight.delete(id)
        if (stopped) return
        // our own /api/presence proxy answers with the bare Lanyard data object;
        // a direct Lanyard base answers {success, data}. Accept both.
        const data = payload && payload.success && payload.data ? payload.data : payload
        if (data && data.discord_user) {
          onUpdate(data)
          return
        }
        throw new Error('presence unavailable')
      })
      .catch((error) => {
        inFlight.delete(id)
        if (stopped) return
        if (onError) onError(error)
        if (attempt < MAX_ATTEMPTS) later(() => load(id, attempt + 1), 1500 * (attempt + 1))
      })
  }

  const connect = () => {
    // no socket endpoint (no location, or nothing configured): the REST snapshot
    // above still populates avatars and decorations, we just lose live updates
    if (stopped || !endpoint) return
    try {
      socket = new WebSocket(endpoint)
    } catch {
      later(connect, RECONNECT_MS)
      return
    }
    socket.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.op === 1) {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) socket.send('{"op":3}')
        }, message.d.heartbeat_interval)
        socket.send(JSON.stringify({ op: 2, d: { subscribe_to_ids: ids } }))
      } else if (message.op === 0 && message.d) {
        if (message.d.discord_user) onUpdate(message.d)
        else {
          for (const key of Object.keys(message.d)) {
            if (message.d[key] && message.d[key].discord_user) onUpdate(message.d[key])
          }
        }
      }
    }
    socket.onclose = () => {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      later(connect, RECONNECT_MS)
    }
    socket.onerror = () => {
      if (socket) socket.close()
    }
  }

  for (const id of ids) load(id)
  connect()

  return () => {
    stopped = true
    for (const id of timers) clearTimeout(id)
    timers.clear()
    if (heartbeat) clearInterval(heartbeat)
    if (reconnect) clearTimeout(reconnect)
    if (socket) {
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
    }
  }
}
