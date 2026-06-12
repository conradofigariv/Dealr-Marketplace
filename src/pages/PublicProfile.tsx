import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Listing, Profile } from '../lib/types'
import Avatar from '../components/Avatar'
import SellerBadges from '../components/SellerBadges'
import StarRating from '../components/StarRating'
import ListingCard from '../components/ListingCard'

// Lo que ve un comprador antes de decidir: reputación, antigüedad,
// insignias y qué más vende. Visible sin cuenta.
export default function PublicProfile() {
  const { username } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!username) return
    supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single()
      .then(({ data }) => {
        if (!data) {
          setNotFound(true)
          return
        }
        setProfile(data)
        supabase
          .from('listings')
          .select('*, seller:profiles(*)')
          .eq('seller_id', data.id)
          .eq('status', 'active')
          .order('last_renewed_at', { ascending: false })
          .then(({ data: rows }) => setListings(rows ?? []))
      })
  }, [username])

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-10 text-center">
        <p className="text-lg font-semibold text-white">Este perfil no existe</p>
        <button onClick={() => navigate('/')} className="text-sm text-neutral-400">
          Volver al inicio
        </button>
      </div>
    )
  }

  if (!profile) return <div className="min-h-dvh bg-black" />

  return (
    <div className="pb-28">
      <header className="relative px-5 pb-6 pt-[max(2rem,env(safe-area-inset-top))] text-center">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Volver"
          className="absolute left-3 top-[max(1.5rem,env(safe-area-inset-top))] p-2 text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <div className="mx-auto mb-4 w-fit">
          <Avatar profile={profile} size="lg" />
        </div>
        <h1 className="text-xl font-bold text-white">{profile.username}</h1>
        <p className="mt-1 text-xs text-neutral-500">
          {profile.zone && <span className="text-neutral-300">{profile.zone} · </span>}
          En Dealr desde {new Date(profile.created_at).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
        </p>
        <div className="mt-4 flex justify-center">
          <SellerBadges profile={profile} />
        </div>
        {profile.seller_score != null && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
            <StarRating value={profile.seller_score} />
            <span>({profile.seller_ratings_count} como vendedor)</span>
          </div>
        )}
      </header>

      <div className="px-5">
        <h2 className="mb-3 text-sm font-semibold text-white">
          {listings.length === 0 ? 'Sin publicaciones activas' : `Publicaciones (${listings.length})`}
        </h2>
        {listings.length > 0 && (
          <div className="columns-2 gap-0.5">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
