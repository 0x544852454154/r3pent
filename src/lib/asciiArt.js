/**
 * The ASCII decode/glitch engine behind every piece of art on the page.
 * Pure data in, DOM rows out: React owns the elements, this owns the animation
 * state, so nothing has to be re-rendered per frame.
 */

const BLANK_BRAILLE = '\u2800'

const BRAILLE_RAMP = (() => {
  let out = ''
  for (let code = 0x2801; code < 0x2900; code++) out += String.fromCharCode(code)
  return out
})()

/**
 * @param {string} text raw art, newline separated
 * @param {{
 *   glyphs: string,
 *   sweep: number,
 *   jitter: number,
 *   order: (r: number, c: number, rows: number, cols: number) => number,
 *   glitchMin?: number, glitchVar?: number, glitchRows?: number,
 *   scanDuration?: number, scanPeriod?: number, scanPeriodVar?: number,
 *   scanWidth?: number, scanUp?: boolean,
 * }} options
 */
export function createAsciiArtEngine(text, options) {
  const o = {
    glitchMin: 3000,
    glitchVar: 3500,
    glitchRows: 4,
    scanDuration: 2600,
    scanPeriod: 3500,
    scanPeriodVar: 3000,
    scanWidth: 2,
    scanUp: false,
    ...options,
  }

  const lines = text.replace(/\n+$/, '').split('\n')
  const rows = lines.length
  let cols = 0
  for (const line of lines) if (line.length > cols) cols = line.length

  const elements = []
  const timings = []
  const rowMax = []
  const rowDone = []
  const rowHot = []

  const randGlyph = () => o.glyphs.charAt((Math.random() * o.glyphs.length) | 0)

  for (let r = 0; r < rows; r++) {
    const timingsRow = []
    let max = 0
    for (let c = 0; c < lines[r].length; c++) {
      const char = lines[r].charAt(c)
      if (char === ' ' || char === BLANK_BRAILLE) {
        timingsRow.push(-1)
        continue
      }
      const time = o.order(r, c, rows, cols) * o.sweep + Math.random() * o.jitter
      timingsRow.push(time)
      if (time > max) max = time
    }
    timings.push(timingsRow)
    rowMax.push(max)
    rowDone.push(false)
    rowHot.push(false)
  }

  let startTime = 0
  let running = false
  let done = false
  let glitchNext = 0
  let glitchEnd = 0
  let glitchSel = []
  let glitchDirty = false
  let scanActive = false
  let scanStart = 0
  let scanNext = 0
  let reduced = false

  function attach(nextElements) {
    elements.length = 0
    for (const element of nextElements) elements.push(element)
  }

  function revealAll() {
    for (let r = 0; r < rows; r++) {
      if (elements[r]) elements[r].textContent = lines[r]
      rowDone[r] = true
      rowHot[r] = false
      if (elements[r]) elements[r].classList.remove('hot')
    }
    done = true
  }

  function start(now, { reduceMotion = false } = {}) {
    reduced = reduceMotion
    startTime = now
    running = true
    done = false
    glitchNext = now + (o.sweep + o.jitter) * 1000 + 2500
    scanNext = now + (o.sweep + o.jitter) * 1000 + 1200
    if (reduced) revealAll()
  }

  function scramble(line) {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      const char = line.charAt(i)
      out += char === ' ' || char === BLANK_BRAILLE || Math.random() > 0.12 ? char : randGlyph()
    }
    return out
  }

  function step(now) {
    if (!running || elements.length === 0) return

    const elapsed = (now - startTime) / 1000

    if (!done) {
      let finished = true
      for (let r = 0; r < rows; r++) {
        if (rowDone[r]) continue
        if (elapsed > rowMax[r] + 0.35) {
          elements[r].textContent = lines[r]
          rowDone[r] = true
          continue
        }
        finished = false
        const line = lines[r]
        const timingsRow = timings[r]
        let out = ''
        for (let c = 0; c < line.length; c++) {
          const time = timingsRow[c]
          if (time < 0) out += line.charAt(c)
          else if (elapsed < time) out += ' '
          else if (elapsed < time + 0.3) out += randGlyph()
          else out += line.charAt(c)
        }
        elements[r].textContent = out
      }
      if (finished) done = true
      return
    }

    if (reduced) return

    // glitch burst
    if (now > glitchNext) {
      glitchEnd = now + 140
      glitchNext = now + o.glitchMin + Math.random() * o.glitchVar
      glitchSel = []
      for (let k = 0; k < o.glitchRows; k++) glitchSel.push((Math.random() * rows) | 0)
    }
    const glitching = now < glitchEnd
    if (glitching) {
      glitchDirty = true
      for (const index of glitchSel) {
        elements[index].style.transform = `translateX(${((Math.random() - 0.5) * 1.6).toFixed(2)}em)`
        elements[index].textContent = scramble(lines[index])
      }
    } else if (glitchDirty) {
      glitchDirty = false
      for (const index of glitchSel) {
        elements[index].style.transform = ''
        elements[index].textContent = lines[index]
      }
    }

    // scan sweep
    if (!scanActive && now > scanNext) {
      scanActive = true
      scanStart = now
    }
    if (!scanActive) return

    const progress = (now - scanStart) / o.scanDuration
    if (progress > 1) {
      scanActive = false
      scanNext = now + o.scanPeriod + Math.random() * o.scanPeriodVar
      for (let r = 0; r < rows; r++) {
        if (!rowHot[r]) continue
        rowHot[r] = false
        elements[r].classList.remove('hot')
      }
      return
    }
    const centre = (o.scanUp ? 1 - progress : progress) * (rows + 2 * o.scanWidth) - o.scanWidth
    for (let r = 0; r < rows; r++) {
      const hot = Math.abs(r - centre) <= o.scanWidth
      if (hot === rowHot[r]) continue
      rowHot[r] = hot
      elements[r].classList.toggle('hot', hot)
    }
  }

  return {
    lines,
    rows,
    cols,
    attach,
    start,
    step,
    revealAll,
    stop() {
      running = false
    },
    get elements() {
      return elements
    },
    get running() {
      return running
    },
    get done() {
      return done
    },
  }
}

/** Art presets: braille art is decoded top-down, the enter art from the centre. */
export const ART_PRESETS = {
  braille: BRAILLE_RAMP,
  glyphs: '.:-=+*#%@',
  banner: '\u2591\u2592\u2593\u2588\u2590\u258c#%&@01',
}

export const ORDER = {
  byRow: (r, _c, rows) => r / rows,
  bottomUpDiagonal: (r, c, rows, cols) => (c / cols) * 0.8 + ((1 - r / rows) * 0.2),
  fromCentre: (r, c, rows, cols) => {
    const dx = (c - cols / 2) / (cols / 2)
    const dy = (r - rows / 2) / (rows / 2)
    return Math.min(1, Math.sqrt(dx * dx * 0.5 + dy * dy * 0.5) / 0.9)
  },
}

export function brailleArt(text, overrides = {}) {
  return createAsciiArtEngine(text, {
    glyphs: ART_PRESETS.braille,
    sweep: 2.4,
    jitter: 0.5,
    order: ORDER.byRow,
    glitchMin: 3000,
    glitchVar: 4000,
    glitchRows: 5,
    scanDuration: 3200,
    scanPeriod: 4000,
    scanPeriodVar: 3000,
    scanWidth: 4,
    scanUp: false,
    ...overrides,
  })
}

/** The decode banner above the roster. */
export function createBannerEngine(lines) {
  const glyphs = ART_PRESETS.banner
  const cols = Math.max(...lines.map((line) => line.length))
  const elements = []
  const revealed = []

  let startTime = Infinity
  let glitchNext = 0
  let glitchEnd = 0
  let glitchSel = []

  const randGlyph = () => glyphs.charAt((Math.random() * glyphs.length) | 0)
  const scrambleLine = (line, fn) => {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      const char = line.charAt(i)
      out += char === ' ' ? ' ' : fn(i, char)
    }
    return out
  }

  for (let r = 0; r < lines.length; r++) revealed.push(false)

  function attach(nextElements) {
    elements.length = 0
    for (const element of nextElements) elements.push(element)
  }

  function start(now) {
    startTime = now
    glitchNext = now + 9000
  }

  function step(now) {
    if (elements.length === 0) return
    const elapsed = (now - startTime) / 1000

    for (let r = 0; r < lines.length; r++) {
      const line = lines[r]
      const rev = (elapsed - 0.3 - r * 0.14) * 75
      if (rev >= line.length + 10) {
        if (!revealed[r]) {
          elements[r].textContent = line
          revealed[r] = true
        }
      } else {
        revealed[r] = false
        elements[r].textContent = scrambleLine(line, (i, char) =>
          i < rev ? char : i < rev + 10 ? randGlyph() : ' ',
        )
      }
    }

    if (elapsed <= 5) return

    if (now > glitchNext) {
      glitchEnd = now + 140
      glitchNext = now + 3500 + Math.random() * 3500
      glitchSel = []
      for (let k = 0; k < 4; k++) glitchSel.push((Math.random() * lines.length) | 0)
    }
    const glitching = now < glitchEnd
    for (let r = 0; r < lines.length; r++) {
      const hot = glitching && glitchSel.indexOf(r) > -1
      elements[r].style.transform = hot ? `translateX(${((Math.random() - 0.5) * 26).toFixed(2)}px)` : ''
      if (hot) {
        elements[r].textContent = scrambleLine(lines[r], (i, char) => (Math.random() < 0.12 ? randGlyph() : char))
      } else if (!glitching && revealed[r] && elements[r].textContent !== lines[r]) {
        elements[r].textContent = lines[r]
      }
    }
  }

  return { lines, cols, attach, start, step }
}
