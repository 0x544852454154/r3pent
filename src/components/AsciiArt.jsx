import { useEffect, useRef } from 'react'

/**
 * Renders the row elements an ascii engine animates. React creates the rows
 * once; the engine writes `textContent` per frame, so nothing re-renders.
 */
export default function AsciiArt({ engine, id, className = 'art', style, ariaHidden = true }) {
  const preRef = useRef(null)

  useEffect(() => {
    const pre = preRef.current
    if (!pre) return undefined
    engine.attach(pre.children)
    return () => engine.attach([])
  }, [engine])

  return (
    <pre ref={preRef} id={id} className={className} style={style} aria-hidden={ariaHidden || undefined}>
      {engine.lines.map((_, index) => (
        <div key={index} />
      ))}
    </pre>
  )
}
