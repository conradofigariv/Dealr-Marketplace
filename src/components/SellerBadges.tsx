import type { Profile } from '../lib/types'

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
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
          <Check /> Identidad verificada
        </span>
      )}
      {profile.phone_verified && (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          <Check /> Teléfono verificado
        </span>
      )}
    </div>
  )
}
