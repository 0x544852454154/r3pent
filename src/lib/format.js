const DISCORD_CDN = 'https://cdn.discordapp.com'
const MEDIA_CDN = 'https://media.discordapp.net'
const SPOTIFY_CDN = 'https://i.scdn.co/image'

export function defaultAvatar(id) {
  try {
    const index = Number((BigInt(id) >> BigInt(22)) % BigInt(6))
    return `${DISCORD_CDN}/embed/avatars/${index}.png`
  } catch {
    return `${DISCORD_CDN}/embed/avatars/0.png`
  }
}

export function avatarUrl(user, size = 128) {
  if (!user || !user.avatar) return defaultAvatar(user ? user.id : 0)
  const extension = user.avatar.indexOf('a_') === 0 ? 'gif' : 'png'
  return `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`
}

export function decorationUrl(user) {
  const asset = user && user.avatar_decoration_data && user.avatar_decoration_data.asset
  return asset ? `${DISCORD_CDN}/avatar-decoration-presets/${asset}.png?size=160&passthrough=true` : null
}

export function emojiUrl(emoji, animated) {
  if (emoji && emoji.id) return `${DISCORD_CDN}/emojis/${emoji.id}${animated ? '.gif' : '.png'}`
  return null
}

/** `1h:04:09` style duration. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n) => (n < 10 ? '0' : '') + n
  return (hours ? pad(hours) + ':' : '') + pad(minutes) + ':' + pad(seconds)
}

export function activityImage(activity, presence) {
  const image = activity && activity.assets && activity.assets.large_image
  if (activity && activity.name === 'Spotify' && presence && presence.spotify) {
    if (presence.spotify.album_art_url) return presence.spotify.album_art_url
  }
  if (!image) return null
  if (image.indexOf('mp:external/') === 0) return `${MEDIA_CDN}/external/${image.slice(12)}`
  if (image.indexOf('mp:') === 0) return `${MEDIA_CDN}/${image.slice(3)}`
  if (image.indexOf('spotify:') === 0) return `${SPOTIFY_CDN}/${image.slice(8)}`
  return activity.application_id
    ? `${DISCORD_CDN}/app-assets/${activity.application_id}/${image}.png`
    : null
}

export const ACTIVITY_TYPES = ['Playing', 'Streaming', 'Listening to', 'Watching', '', 'Competing in']

export function statusLabel(status) {
  if (status === 'dnd') return 'do not disturb'
  return status || 'not tracked'
}
