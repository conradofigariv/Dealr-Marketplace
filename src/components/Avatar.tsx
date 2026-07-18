import { photoUrl } from '../lib/supabase'
import type { Profile } from '../lib/types'

const sizes = {
  sm: 'h-10 w-10 text-base',
  md: 'h-12 w-12 text-lg',
  lg: 'h-20 w-20 text-2xl',
} as const

export default function Avatar({ profile, size = 'md' }: { profile: Profile; size?: keyof typeof sizes }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-900 font-bold text-white ring-1 ring-neutral-800 ${sizes[size]}`}
    >
      {profile.avatar_url ? (
        // no-referrer: las fotos de cuenta de Google (lh3.googleusercontent.com,
        // ver 00047) rechazan la carga con referrer de otro sitio.
        <img src={photoUrl(profile.avatar_url)} alt={profile.username} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        profile.username.slice(0, 1).toUpperCase()
      )}
    </div>
  )
}
