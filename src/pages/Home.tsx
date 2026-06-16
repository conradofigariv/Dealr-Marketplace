import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useNotifications } from '../hooks/useNotifications'
import type { Category, Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'
import FeedFilters, { EMPTY_FILTERS, countActiveFilters, type FeedFilterValues } from '../components/FeedFilters'
import { getCachedBuyerLocation, requestBuyerLocation, haversineKm, type LatLng } from '../lib/geo'

type FeedOrder = 'recent' | 'price_asc' | 'price_desc'

// Cache en memoria del feed: al volver desde un producto no se recarga
// ni se pierde la posición de scroll. Se siente nativo.
let feedCache: {
  listings: Listing[]
  search: string
  categoryId: number | null
  onlyVerified: boolean
  filters: FeedFilterValues
  order: FeedOrder
  scrollY: number
} | null = null
let categoriesCache: Category[] = []

// Tras cambiar el estado de una publicación (vender, pausar, reactivar) la
// caché del feed queda vieja. Esto la descarta para que el próximo render del
// feed traiga datos frescos sin un parpadeo con la lista anterior.
export function invalidateFeedCache() {
  feedCache = null
}

const orderLabels: Record<FeedOrder, string> = {
  recent: 'Recientes',
  price_asc: 'Menor precio',
  price_desc: 'Mayor precio',
}
const orderCycle: Record<FeedOrder, FeedOrder> = {
  recent: 'price_asc',
  price_asc: 'price_desc',
  price_desc: 'recent',
}

export default function Home() {
  const { unreadCount } = useNotifications()
  const [listings, setListings] = useState<Listing[]>(feedCache?.listings ?? [])
  const [categories, setCategories] = useState<Category[]>(categoriesCache)
  const [search, setSearch] = useState(feedCache?.search ?? '')
  const [searchOpen, setSearchOpen] = useState(Boolean(feedCache?.search))
  const [categoryId, setCategoryId] = useState<number | null>(feedCache?.categoryId ?? null)
  const [onlyVerified, setOnlyVerified] = useState(feedCache?.onlyVerified ?? false)
  const [filters, setFilters] = useState<FeedFilterValues>(feedCache?.filters ?? EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [buyerLoc, setBuyerLoc] = useState<LatLng | null>(getCachedBuyerLocation())
  const [order, setOrder] = useState<FeedOrder>(feedCache?.order ?? 'recent')
  const [loading, setLoading] = useState(!feedCache)
  const restoredScroll = useRef(false)

  // Restaurar scroll una sola vez, antes del primer paint
  useLayoutEffect(() => {
    if (feedCache && !restoredScroll.current) {
      restoredScroll.current = true
      window.scrollTo(0, feedCache.scrollY)
    }
  }, [])

  useEffect(() => {
    if (categoriesCache.length) return
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => {
        categoriesCache = data ?? []
        setCategories(categoriesCache)
      })
  }, [])

  const loadFeed = useCallback(async () => {
    // !inner permite filtrar por columnas del vendedor (solo verificados)
    let query = supabase
      .from('listings')
      .select(
        // FK explícita: listings tiene dos referencias a profiles (seller_id y
        // sold_to), así que el embed debe decir cuál usar o PostgREST falla.
        `*, seller:profiles!listings_seller_id_fkey${onlyVerified ? '!inner' : ''}(id, username, avatar_url, phone_verified, identity_verified, seller_score, seller_ratings_count)`,
      )
      .eq('status', 'active')
      .limit(60)
    // Ranking por defecto: lo recién renovado arriba. El usuario puede
    // ordenar por precio desde el control de la barra de filtros.
    if (order === 'price_asc') query = query.order('price', { ascending: true })
    else if (order === 'price_desc') query = query.order('price', { ascending: false })
    else query = query.order('last_renewed_at', { ascending: false })
    if (search.trim()) query = query.ilike('title', `%${search.trim()}%`)
    if (categoryId) query = query.eq('category_id', categoryId)
    if (onlyVerified) query = query.eq('profiles.identity_verified', true)
    // Filtros del panel (precio/moneda/condición se resuelven en la DB; la
    // distancia es client-side porque depende de la ubicación del comprador).
    if (filters.currency !== 'all') query = query.eq('currency', filters.currency)
    if (filters.priceMin && !Number.isNaN(Number(filters.priceMin))) query = query.gte('price', Number(filters.priceMin))
    if (filters.priceMax && !Number.isNaN(Number(filters.priceMax))) query = query.lte('price', Number(filters.priceMax))
    if (filters.conditions.length) query = query.in('condition', filters.conditions)
    const { data } = await query
    const fresh = (data as Listing[]) ?? []
    setListings(fresh)
    setLoading(false)
    feedCache = { listings: fresh, search, categoryId, onlyVerified, filters, order, scrollY: feedCache?.scrollY ?? 0 }
  }, [search, categoryId, onlyVerified, filters, order])

  // Refetch con debounce ante cambios de filtros (y al montar).
  useEffect(() => {
    const timer = setTimeout(loadFeed, 300)
    return () => clearTimeout(timer)
  }, [loadFeed])

  // El feed se cura solo: al volver a la pestaña/app (foreground) recarga,
  // así un cambio de estado hecho en otra pantalla siempre se refleja.
  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === 'visible') loadFeed()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [loadFeed])

  // Guardar la posición de scroll al salir del feed
  useEffect(() => {
    return () => {
      if (feedCache) feedCache.scrollY = window.scrollY
    }
  }, [])

  // Asegura la ubicación del comprador (la pide si hace falta). La usa el
  // filtro de distancia del panel.
  async function ensureLocation(): Promise<boolean> {
    if (buyerLoc) return true
    const loc = await requestBuyerLocation()
    if (!loc) return false
    setBuyerLoc(loc)
    return true
  }

  // Distancia por publicación (para el chip). Si hay radio activo, filtra por
  // cercanía y ordena por distancia. Todo en el cliente: alcanza para una
  // sola ciudad (ranking server-side queda como mejora futura).
  const withDistance = useMemo(() => {
    let arr = listings.map((listing) => ({
      listing,
      distanceKm:
        buyerLoc && listing.lat != null && listing.lng != null
          ? haversineKm(buyerLoc, { lat: listing.lat, lng: listing.lng })
          : undefined,
    }))
    if (filters.radiusKm && buyerLoc) {
      arr = arr
        .filter((x) => x.distanceKm != null && x.distanceKm <= filters.radiusKm!)
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    }
    return arr
  }, [listings, buyerLoc, filters.radiusKm])

  const activeFilters = countActiveFilters(filters)
  const showSkeleton = loading && listings.length === 0

  return (
    <div className="pb-28">
      <header className="px-4 pb-1 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-white">Dealr</h1>
          <div className="flex items-center">
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
            <Link to="/guardados" aria-label="Guardados" className="p-2 text-white">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
              </svg>
            </Link>
            <Link to="/notificaciones" aria-label="Notificaciones" className="relative p-2 text-white">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          </div>
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
        <button
          onClick={() => setFiltersOpen(true)}
          className={`flex shrink-0 items-center gap-1 text-sm font-medium transition ${activeFilters ? 'text-white' : 'text-neutral-500'}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filtros
          {activeFilters > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">
              {activeFilters}
            </span>
          )}
        </button>
        <button
          onClick={() => setOrder(orderCycle[order])}
          className={`flex shrink-0 items-center gap-1 text-sm font-medium transition ${order !== 'recent' ? 'text-white' : 'text-neutral-500'}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M7 12h10M10 18h4" />
          </svg>
          {orderLabels[order]}
        </button>
      </div>

      {showSkeleton ? (
        <div className="columns-2 gap-0.5 px-0">
          {[280, 200, 240, 320, 180, 260].map((h, i) => (
            <div key={i} className="mb-0.5 animate-pulse bg-neutral-900" style={{ height: h }} />
          ))}
        </div>
      ) : withDistance.length === 0 ? (
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          No encontramos publicaciones.
          {(search || categoryId || onlyVerified || activeFilters > 0) && <p className="mt-1">Probá con otros filtros.</p>}
        </div>
      ) : (
        /* Masonry edge-to-edge con separación mínima, estilo Savee */
        <div className="columns-2 gap-0.5">
          {withDistance.map(({ listing, distanceKm }) => (
            <ListingCard key={listing.id} listing={listing} distanceKm={distanceKm} />
          ))}
        </div>
      )}

      {filtersOpen && (
        <FeedFilters
          value={filters}
          onApply={setFilters}
          ensureLocation={ensureLocation}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}
