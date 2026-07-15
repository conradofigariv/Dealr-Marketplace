import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAuthGate } from '../hooks/useAuthGate'
import { useFavorites } from '../hooks/useFavorites'
import type { Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'
import EmptyState from '../components/EmptyState'

export default function Saved() {
  const { session } = useAuth()
  // Releer al volver: reordena/quita lo que se haya destogggleado en otra pantalla.
  const { ids } = useFavorites()
  const [listings, setListings] = useState<Listing[]>([])
  const [fetched, setFetched] = useState(false)

  // Guardia tolerante al resume de la PWA (ver useAuthGate).
  useAuthGate('/guardados')

  useEffect(() => {
    if (!session) return
    supabase
      .from('favorites')
      .select(
        'created_at, listing:listings(*, seller:profiles!listings_seller_id_fkey(id, username, avatar_url, phone_verified, identity_verified, seller_score, seller_ratings_count))',
      )
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as { listing: Listing | null }[])
          .map((r) => r.listing)
          .filter((l): l is Listing => Boolean(l))
        setListings(rows)
        setFetched(true)
      })
    // Recarga cuando cambia el set de favoritos (al guardar/quitar en otra vista).
  }, [session, ids])

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Guardados</h1>
      </header>

      {!fetched ? (
        /* Skeleton mientras carga: antes se veía un instante en blanco. */
        <div className="columns-2 gap-0.5">
          {[240, 300, 200, 280].map((h, i) => (
            <div key={i} className="mb-0.5 animate-pulse rounded-xl bg-neutral-900" style={{ height: h }} />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />}
          title="Todavía no guardaste nada."
        >
          <Link to="/" className="font-semibold text-white">Explorar productos</Link>
        </EmptyState>
      ) : (
        <div className="columns-2 gap-0.5">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
