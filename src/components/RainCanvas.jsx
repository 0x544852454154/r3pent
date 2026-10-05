import { useEffect, useRef } from 'react'
import { useFrame } from '../lib/ticker.jsx'

const GLYPHS = '01<>/\\|+=*:.#%'
const COLUMN_WIDTH = 22
const GLYPH_HEIGHT = 14
const FONT_SIZE = 12

export default function RainCanvas() {
  const canvasRef = useRef(null)
  const drawRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let drops = []
    let width = 0
    let height = 0

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const rebuild = () => {
      const count = Math.ceil(width / COLUMN_WIDTH)
      if (drops.length === count) return
      drops = []
      for (let i = 0; i < count; i++) {
        drops.push({
          y: Math.random() * height,
          v: 1 + Math.random() * 2.4,
          l: 6 + (Math.random() * 9 | 0),
        })
      }
    }

    drawRef.current = () => {
      rebuild()
      ctx.clearRect(0, 0, width, height)
      ctx.font = `${FONT_SIZE}px monospace`
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#b388ff'
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i]
        drop.y += drop.v
        if (drop.y - drop.l * GLYPH_HEIGHT > height) {
          drop.y = -Math.random() * 200
          drop.v = 1 + Math.random() * 2.4
        }
        const row = (drop.y / GLYPH_HEIGHT) | 0
        for (let k = 0; k < drop.l; k++) {
          ctx.globalAlpha = k ? 0.1 * (1 - k / drop.l) : 0.24
          const index = Math.abs(i * 131 + (row - k) * 37) % GLYPHS.length
          ctx.fillText(GLYPHS.charAt(index), i * COLUMN_WIDTH + 4, drop.y - k * GLYPH_HEIGHT)
        }
      }
      ctx.globalAlpha = 1
    }

    resize()
    drawRef.current()

    const onResize = () => {
      resize()
      drawRef.current()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      drawRef.current = null
    }
  }, [])

  useFrame(() => {
    if (drawRef.current) drawRef.current()
  })

  return <canvas id="rain" ref={canvasRef} aria-hidden="true" />
}
