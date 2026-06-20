import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Listing } from '../lib/types'
import { photoUrl } from '../lib/supabase'
import { formatPrice, timeLeftLabel } from '../lib/format'

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
      <h2 className="mb-3 px-1 text-sm font-semibold text-white">🔨 Subastas destacadas</h2>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
        {listings.map((l) => (
          <Link key={l.id} to={`/p/${l.id}`} className="w-40 shrink-0">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-amber-500/30">
              {l.photos?.[0] && (
                <img src={photoUrl(l.photos[0])} alt={l.title} loading="lazy" className="h-full w-full object-cover" />
              )}
              {l.auction_ends_at && (
                <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
                  {timeLeftLabel(l.auction_ends_at, now)}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs font-bold text-amber-400">{formatPrice(l.current_bid ?? l.price, l.currency)}</p>
            <p className="truncate text-xs text-neutral-400">
              {l.bids_count} {l.bids_count === 1 ? 'oferta' : 'ofertas'} · {l.title}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
