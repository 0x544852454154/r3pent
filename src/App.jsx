import { useCallback, useEffect, useMemo, useState } from 'react'
import AsciiArt from './components/AsciiArt.jsx'
import Banner from './components/Banner.jsx'
import EnterGate from './components/EnterGate.jsx'
import FluidCanvas from './components/FluidCanvas.jsx'
import ProfilePopup from './components/ProfilePopup.jsx'
import RainCanvas from './components/RainCanvas.jsx'
import Roster from './components/Roster.jsx'
import usePrefersReducedMotion from './hooks/usePrefersReducedMotion.js'
import { BG_ART, BL_ART, BANNER_ART } from './data/art.js'
import { ORDER, brailleArt } from './lib/asciiArt.js'
import { subscribePresence } from './lib/presence.js'
import { RUNTIME } from './lib/runtime.js'
import { loadRoster } from '@data/roster-source'
import { useFrame } from './lib/ticker.jsx'

export default function App() {
  const reducedMotion = usePrefersReducedMotion()
  const [groups, setGroups] = useState(null)
  const [rosterError, setRosterError] = useState(null)
  const [presence, setPresence] = useState({})
  const [enteredAt, setEnteredAt] = useState(null)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let alive = true
    loadRoster()
      .then((roster) => alive && setGroups(roster))
      .catch((error) => {
        if (!alive) return
        // 403 means the roster token expired while the tab sat in the background
        // (they are short-lived). One reload gets a fresh pair from the server.
        if (error.status === 403) {
          if (sessionStorage.getItem('repent:roster-reload') !== '1') {
            sessionStorage.setItem('repent:roster-reload', '1')
            location.reload()
            return
          }
          sessionStorage.removeItem('repent:roster-reload')
        }
        setRosterError(error.message)
      })
    return () => {
      alive = false
    }
  }, [])

  const ids = useMemo(
    () => (groups || []).flatMap(([, people]) => people.map(([id]) => id)),
    [groups],
  )

  useEffect(() => {
    if (ids.length === 0) return undefined
    return subscribePresence(ids, {
      restBase: RUNTIME.presenceBase,
      socketUrl: RUNTIME.socketUrl,
      token: RUNTIME.token,
      onUpdate(data) {
        const user = data.discord_user
        if (!user) return
        setPresence((previous) =>
          previous[user.id] === data ? previous : { ...previous, [user.id]: data },
        )
      },
    })
  }, [ids])

  const topArt = useMemo(
    () => brailleArt(BG_ART, { scanDuration: 3200, scanPeriod: 4000, scanPeriodVar: 3000, scanWidth: 4 }),
    [],
  )
  const bottomArt = useMemo(
    () =>
      brailleArt(BL_ART, {
        sweep: 1.6,
        jitter: 0.4,
        order: ORDER.bottomUpDiagonal,
        glitchMin: 3500,
        glitchVar: 4000,
        glitchRows: 3,
        scanDuration: 2600,
        scanPeriod: 5500,
        scanPeriodVar: 3000,
        scanWidth: 2,
        scanUp: true,
      }),
    [],
  )

  useEffect(() => {
    if (enteredAt == null) return
    topArt.start(enteredAt + 350, { reduceMotion: reducedMotion })
    bottomArt.start(enteredAt + 700, { reduceMotion: reducedMotion })
  }, [enteredAt, topArt, bottomArt, reducedMotion])

  useFrame((now) => {
    topArt.step(now)
    bottomArt.step(now)
  })

  const open = useMemo(() => {
    if (!openId || !groups) return null
    for (const [role, people] of groups) {
      for (const [id, name] of people) {
        if (id === openId) return { id, name, role }
      }
    }
    return null
  }, [openId, groups])

  const close = useCallback(() => setOpenId(null), [])

  return (
    <>
      <RainCanvas />
      <AsciiArt engine={topArt} id="bgart" />
      <AsciiArt engine={bottomArt} id="blart" />
      <FluidCanvas enabled={!reducedMotion} />
      <EnterGate reducedMotion={reducedMotion} onEnter={setEnteredAt} />
      <div className={enteredAt == null ? 'shell' : 'shell boot'}>
        <Banner art={BANNER_ART} startTime={enteredAt} />
        <div className="sub" />
        <div id="roster">
          <Roster groups={groups} presence={presence} onSelect={setOpenId} />
          {rosterError ? <div className="none">{rosterError}</div> : null}
        </div>
      </div>
      {open ? (
        <ProfilePopup
          id={open.id}
          name={open.name}
          role={open.role}
          presence={presence[open.id]}
          onClose={close}
        />
      ) : null}
    </>
  )
}
