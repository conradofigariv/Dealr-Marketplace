import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'

export default function Home() {
  const [listings, setListings] = useState<Listing[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [onlyVerified, setOnlyVerified] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => setCategories(data ?? []))
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true)
      // !inner permite filtrar por columnas del vendedor (solo verificados)
      let query = supabase
        .from('listings')
        .select(
          `*, seller:profiles${onlyVerified ? '!inner' : ''}(id, username, avatar_url, phone_verified, identity_verified, seller_score, seller_ratings_count)`,
        )
        .eq('status', 'active')
        // Ranking del feed: lo recién renovado arriba, lo viejo se hunde
        .order('last_renewed_at', { ascending: false })
        .limit(60)
      if (search.trim()) query = query.ilike('title', `%${search.trim()}%`)
      if (categoryId) query = query.eq('category_id', categoryId)
      if (onlyVerified) query = query.eq('profiles.identity_verified', true)
      const { data } = await query
      setListings((data as Listing[]) ?? [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, categoryId, onlyVerified])

  return (
    <div className="pb-28">
      <header className="px-4 pb-1 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-white">Dealr</h1>
          <button
            onClick={() => {
              setSearchOpen(!searchOpen)
              if (searchOpen) setSearch('')
            }}
            aria-label="Buscar"
            className="p-2 text-white"
          >
            {searchOpen ? (
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            )}
          </button>
        </div>
        {searchOpen && (
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar productos"
            className="input-line mt-2 text-lg"
          />
        )}
      </header>

      {/* Filtros como tabs de texto, no pills de color */}
      <div className="no-scrollbar flex items-center gap-5 overflow-x-auto px-4 py-3">
        <button
          onClick={() => setCategoryId(null)}
          className={`shrink-0 text-sm font-medium transition ${!categoryId ? 'text-white' : 'text-neutral-500'}`}
        >
          Todo
        </button>
        {categories
          .filter((c) => !c.parent_id)
          .map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
              className={`shrink-0 text-sm font-medium transition ${
                categoryId === cat.id ? 'text-white' : 'text-neutral-500'
              }`}
            >
              {cat.name}
            </button>
          ))}
        <button
          onClick={() => setOnlyVerified(!onlyVerified)}
          className={`shrink-0 text-sm font-medium transition ${onlyVerified ? 'text-white' : 'text-neutral-500'}`}
        >
          ✓ Verificados
        </button>
      </div>

      {loading ? (
        <div className="columns-2 gap-0.5 px-0">
          {[280, 200, 240, 320, 180, 260].map((h, i) => (
            <div key={i} className="mb-0.5 animate-pulse bg-neutral-900" style={{ height: h }} />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          No encontramos publicaciones.
          {(search || categoryId || onlyVerified) && <p className="mt-1">Probá con otros filtros.</p>}
        </div>
      ) : (
        /* Masonry edge-to-edge con separación mínima, estilo Savee */
        <div className="columns-2 gap-0.5">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
