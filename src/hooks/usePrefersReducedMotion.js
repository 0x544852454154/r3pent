import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export default function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false,
  )

  useEffect(() => {
    if (!window.matchMedia) return undefined
    const query = window.matchMedia(QUERY)
    const onChange = (event) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    setReduced(query.matches)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
