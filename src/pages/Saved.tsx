import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useFavorites } from '../hooks/useFavorites'
import type { Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'

export default function Saved() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  // Releer al volver: reordena/quita lo que se haya destogggleado en otra pantalla.
  const { ids } = useFavorites()
  const [listings, setListings] = useState<Listing[]>([])
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: '/guardados', back: '/' } })
  }, [loading, session, navigate])

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

      {fetched && listings.length === 0 ? (
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          Todavía no guardaste nada.
          <Link to="/" className="mt-2 block font-semibold text-white">
            Explorar productos
          </Link>
        </div>
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
