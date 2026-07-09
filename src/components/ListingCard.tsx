import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState, type MouseEvent } from 'react'
import type { Listing } from '../lib/types'
import { photoUrl, supabase } from '../lib/supabase'
import { formatPrice, priceDropPct, isRecentlyPosted, timeAgo, timeLeftLabel } from '../lib/format'
import { formatDistance } from '../lib/geo'
import { useAuth } from '../hooks/useAuth'
import { useFavorites } from '../hooks/useFavorites'
import { useToast } from './Toast'
import LongPressActions from './LongPressActions'
import VerifiedSeal from './VerifiedSeal'
import ConfirmDialog from './ConfirmDialog'
import type { MenuAction } from './ActionMenu'
import { invalidateFeedCache } from '../pages/Home'

// Card estilo Savee: la foto es todo. Solo un precio discreto encima.
export default function ListingCard({
  listing,
  distanceKm,
  index = 0,
}: {
  listing: Listing
  distanceKm?: number
  index?: number
}) {
  const photo = listing.photos[0]
  const dropPct = priceDropPct(listing)
  const recent = isRecentlyPosted(listing.created_at)
  const auction = listing.is_auction
  const auctionPrice = listing.current_bid ?? listing.price
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const toast = useToast()
  const saved = isFavorite(listing.id)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // El "Termina en Xm" de una subasta activa se refresca solo (la card no
  // re-renderiza por sí sola y el countdown quedaba congelado/finalizado).
  const auctionLive = auction && listing.auction_ends_at && new Date(listing.auction_ends_at).getTime() > Date.now()
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!auctionLive) return
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [auctionLive])

  function onSave(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!session) {
      navigate('/auth', { state: { from: '/', back: '/' } })
      return
    }
    toggle(listing.id)
  }

  // Acciones de moderación (long-press), solo admin.
  async function adminDelete() {
    setConfirmDelete(false)
    const { error } = await supabase.from('listings').delete().eq('id', listing.id)
    if (error) return toast(error.message)
    invalidateFeedCache()
    setHidden(true)
    toast('Publicación borrada')
  }

  const adminActions: MenuAction[] = profile?.is_admin
    ? [
        { label: 'Editar', onClick: () => navigate(`/publicar/${listing.id}`) },
        { label: 'Borrar', destructive: true, onClick: () => setConfirmDelete(true) },
      ]
    : []

  if (hidden) return null

  return (
    <LongPressActions actions={adminActions} className="break-inside-avoid">
    <Link
      to={`/p/${listing.id}`}
      className="reveal-card mb-1 block w-full transition active:opacity-80"
      // Cascada: el delay crece con el índice pero se topa, para que las páginas
      // siguientes del scroll infinito no esperen de más.
      style={{ breakInside: 'avoid', animationDelay: `${Math.min(index, 10) * 0.04}s` }}
    >
      <div className="relative overflow-hidden rounded-xl bg-neutral-900">
      {photo ? (
        /* Mientras carga, el contenedor reserva un 3:4 (altura típica de una
           foto de producto): el shimmer ocupa espacio real y el masonry no
           salta de 0 a la altura final con cada imagen que llega (CLS). Al
           cargar, la foto toma su proporción natural. */
        <div className={`relative ${imgLoaded ? '' : 'aspect-[3/4]'}`}>
          {!imgLoaded && <div className="img-shimmer pointer-events-none absolute inset-0" />}
          <img
            src={photoUrl(photo)}
            alt={listing.title}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            className={`block w-full transition-opacity duration-500 ${
              imgLoaded ? 'h-auto opacity-100' : 'absolute inset-0 h-full object-cover opacity-0'
            }`}
          />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center text-neutral-700">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m5 18 5-5 3 3 3-3 3 4" />
          </svg>
        </div>
      )}
      {/* Precio como "botón" sólido: se lee en cualquier foto (antes era texto
          blanco que se perdía en fotos claras). */}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/80 px-2.5 py-1 text-xs font-bold text-white shadow-sm backdrop-blur-sm">
        {formatPrice(auction ? auctionPrice : listing.price, listing.currency)}
      </span>
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
        {auction && (
          <span className="glow-badge rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">Subasta</span>
        )}
        {listing.seller?.identity_verified && (
          <span className="rounded-full bg-black/60 p-1 backdrop-blur-sm" title="Vendedor verificado">
            <VerifiedSeal className="h-4 w-4" />
          </span>
        )}
        {dropPct != null ? (
          <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-black">↓ {dropPct}%</span>
        ) : recent ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-black">Nuevo</span>
        ) : null}
      </div>
      </div>
      {/* Debajo de la foto: título (descripción) ~20% más grande + meta. Sin
          ubicación (location_label), como se pidió. */}
      <div className="px-1.5 pb-1 pt-1.5">
        <p className="line-clamp-2 text-[0.9rem] font-medium leading-snug text-neutral-100">{listing.title}</p>
        <p className={`mt-0.5 truncate text-[11px] ${auction && listing.auction_ends_at ? 'glow-text text-amber-400' : 'text-neutral-500'}`}>
          {auction && listing.auction_ends_at
            ? `${listing.bids_count} ${listing.bids_count === 1 ? 'oferta' : 'ofertas'} · ${timeLeftLabel(listing.auction_ends_at) === 'Finalizada' ? 'Finalizada' : 'Termina en ' + timeLeftLabel(listing.auction_ends_at)}`
            : `${distanceKm != null ? formatDistance(distanceKm) + ' · ' : ''}${timeAgo(listing.created_at)}`}
        </p>
      </div>
    </Link>
    {confirmDelete && (
      <ConfirmDialog
        title="Borrar publicación"
        message={`Vas a borrar "${listing.title}" de forma permanente. No se puede deshacer.`}
        confirmLabel="Borrar"
        destructive
        onConfirm={adminDelete}
        onClose={() => setConfirmDelete(false)}
      />
    )}
    </LongPressActions>
  )
}
