import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsciiArt from './AsciiArt.jsx'
import { ART_PRESETS, ORDER, createAsciiArtEngine } from '../lib/asciiArt.js'
import { useFrame } from '../lib/ticker.jsx'
import { BGM_SRC, ENTER_ART } from '../data/art.js'

const SWEEP = 2.2
const JITTER = 0.6
const DISSOLVE_GLYPHS = '.:-=+*#%@'
const FADE_MS = 950

export default function EnterGate({ reducedMotion, onEnter }) {
  const engine = useMemo(
    () =>
      createAsciiArtEngine(ENTER_ART, {
        glyphs: ART_PRESETS.glyphs,
        sweep: SWEEP,
        jitter: JITTER,
        order: ORDER.fromCentre,
        glitchMin: 2500,
        glitchVar: 2500,
        glitchRows: 4,
        scanDuration: 2200,
        scanPeriod: 3000,
        scanPeriodVar: 2500,
        scanWidth: 2,
        scanUp: false,
      }),
    [],
  )
  const [hidden, setHidden] = useState(false)
  const overlayRef = useRef(null)
  const audioRef = useRef(null)
  const enteredRef = useRef(false)

  useEffect(() => {
    engine.start(performance.now(), { reduceMotion: reducedMotion })
  }, [engine, reducedMotion])

  useFrame((now) => {
    if (!enteredRef.current && !engine.done) engine.step(now)
  })

  const fit = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const height = (window.innerHeight * 0.5) / engine.rows
    const width = (window.innerWidth * 0.9) / (engine.cols * 0.6)
    overlay.style.setProperty('--enter-size', `${Math.max(4, Math.min(height, width, 24))}px`)
  }, [engine])

  useEffect(() => {
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  const reveal = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay || enteredRef.current === 'later') return
    enteredRef.current = 'later'
    if (audioRef.current) audioRef.current.play().catch(() => {})
    overlay.style.transition = 'opacity .9s ease'
    overlay.style.opacity = '0'
    onEnter(performance.now())
    setTimeout(() => setHidden(true), FADE_MS)
  }, [onEnter])

  const enter = useCallback(() => {
    if (enteredRef.current) return
    const overlay = overlayRef.current
    if (overlay) overlay.style.pointerEvents = 'none'
    if (audioRef.current) audioRef.current.play().catch(() => {})
    if (reducedMotion) {
      reveal()
      return
    }

    const rows = engine.elements
    const lines = engine.lines
    engine.stop()
    if (rows.length === 0) {
      reveal()
      return
    }

    const delays = []
    let max = 0
    for (let r = 0; r < engine.rows; r++) {
      const row = []
      for (let c = 0; c < lines[r].length; c++) {
        const dx = (c - engine.cols / 2) / (engine.cols / 2)
        const dy = (r - engine.rows / 2) / (engine.rows / 2)
        const order = Math.min(1, Math.sqrt(dx * dx * 0.5 + dy * dy * 0.5) / 0.9)
        const delay = (1 - order) * SWEEP + Math.random() * JITTER
        row.push(delay)
        if (delay > max) max = delay
      }
      delays.push(row)
    }

    const startedAt = performance.now()
    const step = (now) => {
      const t = (now - startedAt) / 1000
      for (let r = 0; r < engine.rows; r++) {
        const line = lines[r]
        let out = ''
        for (let c = 0; c < line.length; c++) {
          const char = line.charAt(c)
          if (char === ' ') out += ' '
          else if (t < delays[r][c]) out += char
          else if (t < delays[r][c] + 0.3) out += DISSOLVE_GLYPHS.charAt((Math.random() * DISSOLVE_GLYPHS.length) | 0)
          else out += ' '
        }
        rows[r].textContent = out
      }
      if (t < max + 0.35) requestAnimationFrame(step)
      else reveal()
    }
    requestAnimationFrame(step)
  }, [engine, reducedMotion, reveal])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        enter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enter])

  return (
    <>
      <audio id="bgm" ref={audioRef} src={BGM_SRC} loop preload="auto" />
      {hidden ? null : (
        <div
          id="enter"
          ref={overlayRef}
          role="button"
          tabIndex={0}
          aria-label="Enter"
          onClick={enter}
        >
          <AsciiArt engine={engine} id="enterart" ariaHidden={false} />
        </div>
      )}
    </>
  )
}
