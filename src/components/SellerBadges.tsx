import type { Profile } from '../lib/types'
import VerifiedSeal from './VerifiedSeal'

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// Señales de confianza: cubren el arranque en frío cuando todavía
// no hay calificaciones acumuladas.
export default function SellerBadges({ profile }: { profile: Profile }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {profile.identity_verified && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500/15 to-blue-600/15 px-2.5 py-1 text-xs font-semibold text-sky-300 ring-1 ring-inset ring-sky-400/30">
          <VerifiedSeal className="h-4 w-4" /> Identidad verificada
        </span>
      )}
      {profile.phone_verified && (
        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300">
          <Check /> Teléfono verificado
        </span>
      )}
    </div>
  )
}
