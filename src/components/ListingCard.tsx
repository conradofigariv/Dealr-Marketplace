import { Link } from 'react-router-dom'
import type { Listing } from '../lib/types'
import { photoUrl } from '../lib/supabase'
import { formatPrice } from '../lib/format'

// Card estilo Savee: la foto es todo. Solo un precio discreto encima.
export default function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.photos[0]
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
      <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
        {formatPrice(listing.price, listing.currency)}
      </span>
      {listing.seller?.identity_verified && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm" title="Vendedor verificado">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}
    </Link>
  )
}
