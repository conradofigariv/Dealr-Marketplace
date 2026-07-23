import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Listing } from '../lib/types'
import { photoUrl, thumbUrl } from '../lib/supabase'
import { formatPrice, timeLeftLabel } from '../lib/format'
import SmartImage from './SmartImage'

// Riel destacado de subastas: las que están por terminar, con cuenta
// regresiva en vivo (tick cada segundo). La función estrella, arriba del feed.
export default function AuctionRail({ listings }: { listings: Listing[] }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (listings.length === 0) return null
  return (
    <div>
      <h2 className="glow-text mb-3 px-1 text-base font-semibold text-amber-400">Subastas destacadas</h2>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
        {listings.map((l) => (
          <Link key={l.id} to={`/p/${l.id}`} className="w-40 shrink-0">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-amber-500/30">
              {l.photos?.[0] && (
                <SmartImage
                  src={thumbUrl(l.photos[0])}
                  fallbackSrc={photoUrl(l.photos[0])}
                  alt={l.title}
                  loading="lazy"
                  wrapperClassName="absolute inset-0"
                  className="h-full w-full object-cover"
                />
              )}
              {l.auction_ends_at && (
                <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
                  {timeLeftLabel(l.auction_ends_at, now)}
                </span>
              )}
              {/* Precio como pill amarillo sobre la foto (misma modalidad que
                  ListingCard, en ámbar por ser subasta). */}
              <span className="absolute bottom-2 left-2 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-black shadow-sm">
                {formatPrice(l.current_bid ?? l.price, l.currency)}
              </span>
            </div>
            {/* Nombre en blanco + ofertas, con los mismos tamaños que
                "Recomendado para vos" (ListingCard). */}
            <p className="mt-1.5 line-clamp-2 text-[0.9rem] font-medium leading-snug text-white">{l.title}</p>
            <p className="mt-0.5 truncate text-[11px] text-amber-400">
              {l.bids_count} {l.bids_count === 1 ? 'oferta' : 'ofertas'}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
