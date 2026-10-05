import { useEffect, useRef } from 'react'
import { createFluidSimulation } from '../lib/fluid.js'

export default function FluidCanvas({ enabled = true }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    const simulation = createFluidSimulation(canvasRef.current)
    return () => simulation && simulation.destroy()
  }, [enabled])

  return <canvas id="fluid" ref={canvasRef} aria-hidden="true" />
}
