import { useEffect, useRef, useState } from 'react'
import {
  ACTIVITY_TYPES,
  activityImage,
  avatarUrl,
  decorationUrl,
  defaultAvatar,
  emojiUrl,
  formatDuration,
  statusLabel,
} from '../lib/format.js'

function CustomStatus({ activity }) {
  const state = (activity.state || '').trim()
  const emoji = activity.emoji
  const image = emojiUrl(emoji, activity.emoji && activity.emoji.animated)
  if (!state && !emoji) return null
  return (
    <div className="cs">
      {image ? <img alt="" src={image} /> : emoji && emoji.name ? `${emoji.name} ` : null}
      {state}
    </div>
  )
}

function Activity({ activity, presence, now }) {
  if (activity.type === 4) return <CustomStatus activity={activity} />

  const image = activityImage(activity, presence)
  const spotify = activity.name === 'Spotify' && presence.spotify
  const started = activity.timestamps && activity.timestamps.start

  return (
    <div className="act">
      {image ? <img alt="" src={image} referrerPolicy="no-referrer" /> : null}
      <div className="t">
        <b>{`${ACTIVITY_TYPES[activity.type] || ''} ${activity.name || ''}`.trim()}</b>
        {spotify ? (
          <>
            {presence.spotify.song ? <span>{presence.spotify.song}</span> : null}
            {presence.spotify.artist ? <span>{presence.spotify.artist}</span> : null}
          </>
        ) : (
          <>
            {activity.details ? <span>{activity.details}</span> : null}
            {activity.state ? <span>{activity.state}</span> : null}
          </>
        )}
        {started ? <span className="el">{formatDuration(now - started)} elapsed</span> : null}
      </div>
    </div>
  )
}

export default function ProfilePopup({ id, name, role, presence, onClose }) {
  const [now, setNow] = useState(() => Date.now())
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current && closeRef.current.focus()
  }, [id])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const user = presence && presence.discord_user
  const status = presence ? presence.discord_status || 'offline' : 'offline'
  const decoration = decorationUrl(user)
  const activities = presence ? (presence.activities || []).slice(0, 4) : []
  const shown = activities.filter((activity) => activity.type !== 4 || activity.state || activity.emoji)

  return (
    <div id="pf" role="dialog" aria-modal="true" aria-label="Member profile">
      <div id="pfbk" onClick={onClose} />
      <div id="pfc">
        <button id="pfx" aria-label="Close" ref={closeRef} onClick={onClose}>
          ×
        </button>
        <div id="pfav">
          <img
            id="pfimg"
            alt=""
            referrerPolicy="no-referrer"
            src={user ? avatarUrl(user, 256) : defaultAvatar(id)}
          />
          <img id="pfdeco" alt="" hidden={!decoration} src={decoration || undefined} />
          <span id="pfdot" className={status} />
        </div>
        <div id="pfn">{user ? user.global_name || user.display_name || user.username : name}</div>
        <div id="pfu">{`@${user ? user.username : name}`}</div>
        <div id="pfr">{role}</div>
        <div id="pfs">
          <span id="pfsd" className={status} />
          <span id="pfst">{user ? statusLabel(status) : 'not tracked'}</span>
        </div>
        <div id="pfa">
          {!presence ? (
            <div className="none">presence unavailable</div>
          ) : shown.length === 0 ? (
            <div className="none">no activity right now</div>
          ) : (
            shown.map((activity, index) => (
              <Activity
                key={`${activity.name}-${index}`}
                activity={activity}
                presence={presence}
                now={now}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
