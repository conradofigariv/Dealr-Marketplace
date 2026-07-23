import { Link } from 'react-router-dom'
import type { Listing } from '../lib/types'
import { photoUrl, thumbUrl } from '../lib/supabase'
import { formatPrice } from '../lib/format'

type RailListing = Pick<Listing, 'id' | 'title' | 'price' | 'currency' | 'photos'>

// Riel horizontal de mini-cards: "Productos similares" y "Más de este
// vendedor" en el detalle, estilo Marketplace.
export default function ListingRail({ title, listings }: { title: string; listings: RailListing[] }) {
  if (listings.length === 0) return null
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
      <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5">
        {listings.map((l) => (
          <Link key={l.id} to={`/p/${l.id}`} className="w-32 shrink-0">
            <div className="aspect-square w-full overflow-hidden rounded-xl bg-neutral-900">
              {l.photos?.[0] && (
                <img
                  src={thumbUrl(l.photos[0])}
                  alt={l.title}
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget
                    if (img.dataset.full) return
                    img.dataset.full = '1'
                    img.src = photoUrl(l.photos![0])
                  }}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <p className="mt-1.5 text-xs font-bold text-white">{formatPrice(l.price, l.currency)}</p>
            <p className="truncate text-xs text-neutral-400">{l.title}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
