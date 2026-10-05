/**
 * Lanyard presence feed (REST snapshot + websocket deltas).
 *
 * Both URLs are required and arrive from the server-injected config block, so
 * the shipped bundle carries neither the upstream host nor our own endpoint
 * path. There is deliberately no fallback: a hardcoded default would be a
 * literal in the bundle and would silently bypass the proxy when it was wrong.
 */
const RECONNECT_MS = 3000
const MAX_ATTEMPTS = 3

export function subscribePresence(ids, options = {}) {
  const { onUpdate, onError, restBase, socketUrl, token = '' } = options
  if (!restBase || !socketUrl) return undefined
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
        if (payload && payload.success && payload.data) {
          onUpdate(payload.data)
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
    if (stopped) return
    try {
      socket = new WebSocket(socketUrl)
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
