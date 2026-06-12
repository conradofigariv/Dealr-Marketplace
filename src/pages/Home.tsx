import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'

export default function Home() {
  const [listings, setListings] = useState<Listing[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
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
    <div className="pb-20">
      <header className="bg-brand-700 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="mb-3 text-xl font-extrabold tracking-tight text-white">
          Dealr
          <span className="ml-2 text-sm font-normal text-brand-100">Usados en Córdoba</span>
        </h1>
        <div className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar productos..."
            className="w-full bg-transparent text-sm text-white placeholder-brand-100 outline-none"
          />
        </div>
      </header>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
        <button
          onClick={() => setOnlyVerified(!onlyVerified)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
            onlyVerified ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
          }`}
        >
          ✓ Solo verificados
        </button>
        {categories
          .filter((c) => !c.parent_id)
          .map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                categoryId === cat.id ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-gray-500">
          <p className="mb-1 text-3xl">🔍</p>
          No encontramos publicaciones.
          {(search || categoryId || onlyVerified) && <p>Probá con otros filtros.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
