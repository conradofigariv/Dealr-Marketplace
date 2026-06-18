import { Link, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import type { Listing } from '../lib/types'
import { photoUrl } from '../lib/supabase'
import { formatPrice, priceDropPct, isRecentlyPosted, timeAgo } from '../lib/format'
import { formatDistance } from '../lib/geo'
import { useAuth } from '../hooks/useAuth'
import { useFavorites } from '../hooks/useFavorites'

// Card estilo Savee: la foto es todo. Solo un precio discreto encima.
export default function ListingCard({ listing, distanceKm }: { listing: Listing; distanceKm?: number }) {
  const photo = listing.photos[0]
  const dropPct = priceDropPct(listing)
  const recent = isRecentlyPosted(listing.created_at)
  const navigate = useNavigate()
  const { session } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const saved = isFavorite(listing.id)

  function onSave(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!session) {
      navigate('/auth', { state: { from: '/', back: '/' } })
      return
    }
    toggle(listing.id)
  }

  return (
    <Link
      to={`/p/${listing.id}`}
      className="relative mb-0.5 block w-full overflow-hidden bg-neutral-900 transition active:opacity-80"
      style={{ breakInside: 'avoid' }}
    >
      {photo ? (
        <img src={photoUrl(photo)} alt={listing.title} loading="lazy" decoding="async" className="block h-auto w-full" />
      ) : (
        <div className="flex aspect-square items-center justify-center text-neutral-700">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m5 18 5-5 3 3 3-3 3 4" />
          </svg>
        </div>
      )}
      {/* Barra inferior: precio + título, a lo ancho de la imagen. El título
          se corta con elipsis donde termina la foto. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-2.5 pb-2 pt-7">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs font-bold text-white">
            {formatPrice(listing.price, listing.currency)}
          </span>
          <span className="truncate text-xs text-white/85">{listing.title}</span>
          {distanceKm != null && (
            <span className="ml-auto shrink-0 text-[10px] font-medium text-white/70">{formatDistance(distanceKm)}</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-white/55">
          {listing.location_label ? `${listing.location_label} · ` : ''}
          {timeAgo(listing.created_at)}
        </p>
      </div>
      <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5">
        {listing.photos.length > 1 && (
          <span className="rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm" title={`${listing.photos.length} fotos`}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="8" width="13" height="13" rx="2" />
              <path d="M4 16V5a1 1 0 0 1 1-1h11" />
            </svg>
          </span>
        )}
        <button
          onClick={onSave}
          aria-label={saved ? 'Quitar de guardados' : 'Guardar'}
          aria-pressed={saved}
          className="rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm transition active:scale-90"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 ${saved ? 'fill-red-500 stroke-red-500' : 'fill-none stroke-white'}`}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
          </svg>
        </button>
      </div>
      <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
        {listing.seller?.identity_verified && (
          <span className="rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm" title="Vendedor verificado">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
        {dropPct != null ? (
          <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-black">↓ {dropPct}%</span>
        ) : recent ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-black">Nuevo</span>
        ) : null}
      </div>
    </Link>
  )
}
