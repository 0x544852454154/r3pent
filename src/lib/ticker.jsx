import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

/**
 * One requestAnimationFrame loop for the whole page. The original page drove the
 * banner, the rain and the ASCII art from a single `loop()`; this keeps that
 * single-loop behaviour (and the single paint) now that the components are
 * independent React subtrees.
 */
const TickerContext = createContext(null)

export function TickerProvider({ children }) {
  const subscribers = useRef(new Set())

  useEffect(() => {
    let raf = 0
    let alive = true
    const loop = (now) => {
      if (!alive) return
      for (const subscriber of subscribers.current) {
        try {
          subscriber(now)
        } catch (error) {
          console.error('[ticker]', error)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      subscribers.current.clear()
    }
  }, [])

  const subscribe = useCallback((subscriber) => {
    subscribers.current.add(subscriber)
    return () => {
      subscribers.current.delete(subscriber)
    }
  }, [])

  return <TickerContext.Provider value={{ subscribe }}>{children}</TickerContext.Provider>
}

/**
 * @param {(now: number) => void} callback
 */
export function useFrame(callback) {
  const context = useContext(TickerContext)
  const latest = useRef(callback)
  latest.current = callback

  useEffect(() => {
    if (!context) return undefined
    return context.subscribe((now) => latest.current(now))
  }, [context])
}
