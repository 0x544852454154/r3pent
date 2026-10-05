import { useEffect, useRef } from 'react'
import { createBannerEngine } from '../lib/asciiArt.js'
import { useFrame } from '../lib/ticker.jsx'

const narrow = () => window.innerWidth < 700

export default function Banner({ art, startTime }) {
  const engineRef = useRef(null)
  const hostRef = useRef(null)
  if (engineRef.current === null) engineRef.current = createBannerEngine(art)

  useEffect(() => {
    const host = hostRef.current
    if (host) engineRef.current.attach(host.children)
  }, [])

  useEffect(() => {
    if (startTime == null) return
    engineRef.current.start(startTime)
  }, [startTime])

  useEffect(() => {
    const fit = () => {
      const host = hostRef.current
      if (!host) return
      const cols = engineRef.current.cols
      const widthFactor = narrow() ? 0.86 : 0.29
      const size = Math.max(5, Math.min(20, (window.innerWidth * widthFactor) / (cols * 0.6)))
      host.style.fontSize = `${size}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useFrame((now) => engineRef.current.step(now))

  return (
    <div id="banner" ref={hostRef}>
      {art.map((_, index) => (
        <div key={index} />
      ))}
    </div>
  )
}
