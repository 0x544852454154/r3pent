/**
 * Copy / right-click / inspect-element guards (production only).
 *
 * Reality check, because it matters: none of this protects anything. Everything
 * here ships in the bundle, so anyone determined opens devtools, disables the
 * script, or just reads the network tab. What it does buy you is removing the
 * one-click paths - right-click -> view source, select-all + copy, F12, and the
 * inspect-element shortcut - and covering the screen if devtools ends up docked
 * anyway.
 *
 * Flags:
 *   VITE_GUARD=0        disables every guard below (recommended while debugging)
 *   VITE_GUARD_VEIL=0   keeps the shortcuts/clipboard blocks, drops the veil
 *
 * Not implemented on purpose: `debugger` traps, timing loops and right-click
 * replacement menus. The first two freeze the page for legitimate visitors and
 * are defeated by one click in devtools ("never pause on exceptions"); the third
 * makes right-click feel broken and still loses to Shift+right-click, which
 * bypasses any JS handler.
 *
 * Cannot be implemented at all, from a page: anything that is browser chrome
 * rather than a DOM event - ctrl/cmd+shift+delete (clear browsing data),
 * ctrl/cmd+shift+W (close window), a saved copy of the already-downloaded file,
 * or devtools opened before this script ran. A page cannot intercept its own
 * download. Treat these guards as friction, not as a lock.
 */

const DEVTOOLS_PX = 160
const DEVTOOLS_STRIKES = 3
const DEVTOOLS_POLL_MS = 700
const VEIL_ID = 'guard-veil'

const EDITABLE = /^(input|textarea|select)$/i

const isEditable = (target) =>
  !!target && (target.isContentEditable || EDITABLE.test(target.tagName || ''))

export function installGuards() {
  if (!import.meta.env.PROD) return
  if (import.meta.env.VITE_GUARD === '0') return

  installClipboardGuards()
  installMenuGuards()
  installShortcutGuards()
  if (import.meta.env.VITE_GUARD_VEIL !== '0') installDevtoolsVeil()
}

/**
 * Nothing on this page is meant to be selectable, so block the clipboard events
 * outright. Form fields are left alone so a login or search box would still work.
 */
function installClipboardGuards() {
  const block = (event) => {
    if (isEditable(event.target)) return
    event.preventDefault()
  }
  document.addEventListener('copy', block, true)
  document.addEventListener('cut', block, true)
  document.addEventListener('dragstart', block, true)
  document.addEventListener('selectstart', block, true)
}

function installMenuGuards() {
  document.addEventListener('contextmenu', (event) => event.preventDefault(), true)
  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 2) event.preventDefault()
    },
    true,
  )
  // middle click pastes / autoscrolls in some Linux window managers
  window.addEventListener(
    'auxclick',
    (event) => {
      if (event.button === 1) event.preventDefault()
    },
    true,
  )
}

function installShortcutGuards() {
  window.addEventListener(
    'keydown',
    (event) => {
      const key = (event.key || '').toUpperCase()
      const accel = event.ctrlKey || event.metaKey

      if (key === 'F12') return event.preventDefault()
      // ctrl/cmd+shift+I/J/C -> devtools / inspect / console
      if (accel && event.shiftKey && (key === 'I' || key === 'J' || key === 'C')) {
        event.preventDefault()
      }
      // ctrl/cmd+U -> view source
      if (accel && key === 'U' && !event.shiftKey) event.preventDefault()
      // ctrl/cmd+P -> print dialog, which dumps the art as text
      if (accel && key === 'P') event.preventDefault()
      // Safari: cmd+opt+I
      if (event.metaKey && event.altKey && (key === 'I' || key === 'J' || key === 'C')) {
        event.preventDefault()
      }
    },
    true,
  )

  // the keydown handler alone does not stop the print dialog in every browser,
  // but cancelling beforeprint does
  window.addEventListener('beforeprint', (event) => event.preventDefault(), true)
}

/**
 * Covers the page while devtools looks docked to the side or the bottom.
 *
 * Detection is the standard viewport/outer-window delta. It is a heuristic and
 * it can misfire: a very high browser zoom shrinks the viewport without any
 * devtools open. The 3-strike requirement plus the generous threshold keep that
 * rare, and `VITE_GUARD=0` is the escape hatch. Phones are skipped entirely
 * because the on-screen keyboard resizes the viewport the same way.
 */
function installDevtoolsVeil() {
  const delta = () =>
    Math.max(window.outerWidth - window.innerWidth, window.outerHeight - window.innerHeight)

  let baseline = delta()
  let strikes = 0
  let veil = null

  const show = () => {
    if (veil) return
    veil = document.createElement('div')
    veil.id = VEIL_ID
    veil.setAttribute('aria-hidden', 'true')
    veil.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:#000;display:none;' +
      'color:#b388ff;font:14px/1.5 "Cascadia Code",Consolas,monospace;' +
      'align-items:center;justify-content:center;text-align:center;cursor:default'
    document.documentElement.appendChild(veil)
    veil.style.display = 'flex'
  }

  const hide = () => {
    if (veil) veil.style.display = 'none'
  }

  window.setInterval(() => {
    if (window.innerWidth < 500) return
    const current = delta()
    if (current > baseline + DEVTOOLS_PX) {
      strikes++
      if (strikes >= DEVTOOLS_STRIKES) show()
    } else {
      strikes = 0
      hide()
    }
    // let the baseline creep upward so a single large window never sticks
    baseline = Math.min(Math.max(baseline, current - 40), current + 40)
  }, DEVTOOLS_POLL_MS)
}
