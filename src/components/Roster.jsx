import { useEffect, useState } from 'react'
import { avatarUrl, decorationUrl, defaultAvatar } from '../lib/format.js'

function Member({ id, fallbackName, presence, onSelect }) {
  const user = presence && presence.discord_user
  const status = (presence && presence.discord_status) || 'offline'
  const remote = user ? avatarUrl(user, 128) : defaultAvatar(id)
  const [src, setSrc] = useState(remote)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setSrc(remote)
    setBroken(false)
  }, [remote])

  const decoration = decorationUrl(user)
  const name = user ? user.global_name || user.display_name || user.username : fallbackName

  return (
    <div className="m" onClick={() => onSelect(id)} role="button" tabIndex={0} title={fallbackName}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(id)
        }
      }}
    >
      <div className="av">
        <img
          className="pic"
          alt=""
          referrerPolicy="no-referrer"
          src={broken ? defaultAvatar(id) : src}
          onError={() => setBroken(true)}
        />
        <img className="deco" alt="" hidden={!decoration} src={decoration || undefined} />
        <span className={`dot ${status}`} />
      </div>
      <div className="nm">{name}</div>
    </div>
  )
}

export default function Roster({ groups, presence, onSelect }) {
  if (!groups) return null
  return groups.map(([group, people]) => (
    <section className="grp" key={group}>
      <div className="grp-h">
        {group}
        <i>[{people.length}]</i>
      </div>
      <div className="row">
        {people.map(([id, fallbackName]) => (
          <Member
            key={id}
            id={id}
            fallbackName={fallbackName}
            presence={presence[id]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  ))
}
