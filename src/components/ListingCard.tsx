import { Link } from 'react-router-dom'
import type { Listing } from '../lib/types'
import { photoUrl } from '../lib/supabase'
import { formatPrice, conditionLabels } from '../lib/format'
import StarRating from './StarRating'

export default function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.photos[0]
  return (
    <Link
      to={`/p/${listing.id}`}
      className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100 transition active:scale-[0.98]"
    >
      <div className="relative aspect-square bg-gray-100">
        {photo ? (
          <img src={photoUrl(photo)} alt={listing.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-300">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.5" />
              <path d="m5 18 5-5 3 3 3-3 3 4" />
            </svg>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
          {conditionLabels[listing.condition]}
        </span>
        {listing.seller?.identity_verified && (
          <span className="absolute right-2 top-2 rounded-full bg-brand-700 p-1 text-white" title="Vendedor verificado">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="truncate text-sm text-gray-700">{listing.title}</p>
        <div className="flex items-center justify-between">
          <p className="text-base font-bold">{formatPrice(listing.price, listing.currency)}</p>
          {listing.seller?.seller_score != null && <StarRating value={listing.seller.seller_score} />}
        </div>
      </div>
    </Link>
  )
}
