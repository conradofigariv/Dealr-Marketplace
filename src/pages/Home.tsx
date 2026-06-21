import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import type { Category, Listing } from '../lib/types'
import ListingCard from '../components/ListingCard'
import ListingRail from '../components/ListingRail'
import AuctionRail from '../components/AuctionRail'
import FeedFilters, { EMPTY_FILTERS, countActiveFilters, filterableFields, type FeedFilterValues } from '../components/FeedFilters'
import {
  getCachedBuyerLocation,
  requestBuyerLocation,
  haversineKm,
  reverseGeocode,
  getCachedBuyerLabel,
  cacheBuyerLabel,
  getRecentlyViewed,
  type LatLng,
} from '../lib/geo'

type FeedOrder = 'recent' | 'price_asc' | 'price_desc'

const PAGE_SIZE = 24

// Cache en memoria del feed: al volver desde un producto no se recarga
// ni se pierde la posición de scroll. Se siente nativo.
let feedCache: {
  listings: Listing[]
  page: number
  hasMore: boolean
  search: string
  categoryId: number | null
  onlyVerified: boolean
  onlyAuctions: boolean
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

// Abrir el feed con un estado prearmado (desde Explorar o Búsquedas guardadas).
// Home lo consume al montar, pisando la caché.
export interface FeedQuery {
  search?: string
  categoryId?: number | null
  filters?: FeedFilterValues
}
let pendingFeedState: FeedQuery | null = null
export function openFeed(state: FeedQuery) {
  pendingFeedState = state
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

const SELECT =
  '*, seller:profiles!listings_seller_id_fkey'

export default function Home() {
  const { unreadCount } = useNotifications()
  const { session } = useAuth()
  const navigate = useNavigate()
  // Estado prearmado (Explorar / Búsquedas guardadas): tiene prioridad sobre
  // la caché y se consume una sola vez.
  const pending = pendingFeedState
  pendingFeedState = null
  const [listings, setListings] = useState<Listing[]>(pending ? [] : feedCache?.listings ?? [])
  const [categories, setCategories] = useState<Category[]>(categoriesCache)
  const [search, setSearch] = useState(pending?.search ?? feedCache?.search ?? '')
  const [searchOpen, setSearchOpen] = useState(Boolean(pending?.search ?? feedCache?.search))
  const [categoryId, setCategoryId] = useState<number | null>(pending?.categoryId ?? feedCache?.categoryId ?? null)
  const [onlyVerified, setOnlyVerified] = useState(feedCache?.onlyVerified ?? false)
  const [onlyAuctions, setOnlyAuctions] = useState(feedCache?.onlyAuctions ?? false)
  const [featuredAuctions, setFeaturedAuctions] = useState<Listing[]>([])
  const [filters, setFilters] = useState<FeedFilterValues>(pending?.filters ?? feedCache?.filters ?? EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [savedSearch, setSavedSearch] = useState(false)
  const [buyerLoc, setBuyerLoc] = useState<LatLng | null>(getCachedBuyerLocation())
  const [buyerLabel, setBuyerLabel] = useState<string | null>(getCachedBuyerLabel())
  const [locating, setLocating] = useState(false)
  const [order, setOrder] = useState<FeedOrder>(feedCache?.order ?? 'recent')
  const [loading, setLoading] = useState(pending ? true : !feedCache)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(feedCache?.hasMore ?? true)
  const [recentItems, setRecentItems] = useState<Listing[]>([])
  const pageRef = useRef(feedCache?.page ?? 0)
  const restoredScroll = useRef(false)
  const firstLoad = useRef(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

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

  // Subastas destacadas: activas, las que terminan antes.
  useEffect(() => {
    supabase
      .from('listings')
      .select('id, title, price, currency, photos, current_bid, bids_count, auction_ends_at')
      .eq('is_auction', true)
      .eq('status', 'active')
      .gt('auction_ends_at', new Date().toISOString())
      .order('auction_ends_at', { ascending: true })
      .limit(12)
      .then(({ data }) => setFeaturedAuctions((data as Listing[]) ?? []))
  }, [])

  // Vistos recientemente (localStorage): solo en la vista por defecto.
  const defaultView = !search.trim() && !categoryId && !onlyVerified && !onlyAuctions && countActiveFilters(filters) === 0
  useEffect(() => {
    const ids = getRecentlyViewed()
    if (ids.length === 0) {
      setRecentItems([])
      return
    }
    supabase
      .from('listings')
      .select('id, title, price, currency, photos')
      .in('id', ids)
      .eq('status', 'active')
      .then(({ data }) => {
        const byId = new Map((data ?? []).map((l) => [l.id, l as Listing]))
        setRecentItems(ids.map((id) => byId.get(id)).filter((l): l is Listing => Boolean(l)))
      })
  }, [])

  // Construye la query del feed con los filtros actuales (sin paginar).
  const buildQuery = useCallback(() => {
    let query = supabase
      .from('listings')
      // FK explícita: listings tiene dos referencias a profiles (seller_id y
      // sold_to), así que el embed debe decir cuál usar o PostgREST falla.
      .select(`${SELECT}${onlyVerified ? '!inner' : ''}(id, username, avatar_url, phone_verified, identity_verified, seller_score, seller_ratings_count)`)
      .eq('status', 'active')
    if (onlyAuctions) query = query.eq('is_auction', true)
    if (onlyAuctions) query = query.order('auction_ends_at', { ascending: true })
    else if (order === 'price_asc') query = query.order('price', { ascending: true })
    else if (order === 'price_desc') query = query.order('price', { ascending: false })
    else query = query.order('last_renewed_at', { ascending: false })
    const term = search.trim().replace(/[,()]/g, ' ').trim()
    if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`)
    if (categoryId) query = query.eq('category_id', categoryId)
    if (onlyVerified) query = query.eq('profiles.identity_verified', true)
    if (filters.currency !== 'all') query = query.eq('currency', filters.currency)
    if (filters.priceMin && !Number.isNaN(Number(filters.priceMin))) query = query.gte('price', Number(filters.priceMin))
    if (filters.priceMax && !Number.isNaN(Number(filters.priceMax))) query = query.lte('price', Number(filters.priceMax))
    if (filters.conditions.length) query = query.in('condition', filters.conditions)
    // Filtros por campo de categoría (sobre el jsonb structured_fields).
    for (const [key, val] of Object.entries(filters.fields)) {
      query = query.eq(`structured_fields->>${key}`, val)
    }
    return query
  }, [search, categoryId, onlyVerified, onlyAuctions, filters, order])

  // Primera página (reset): reemplaza la lista.
  const loadFirst = useCallback(async () => {
    const { data } = await buildQuery().range(0, PAGE_SIZE - 1)
    const batch = (data as Listing[]) ?? []
    pageRef.current = 0
    setListings(batch)
    setHasMore(batch.length === PAGE_SIZE)
    setLoading(false)
    feedCache = {
      listings: batch,
      page: 0,
      hasMore: batch.length === PAGE_SIZE,
      search,
      categoryId,
      onlyVerified,
      onlyAuctions,
      filters,
      order,
      scrollY: feedCache?.scrollY ?? 0,
    }
  }, [buildQuery, search, categoryId, onlyVerified, onlyAuctions, filters, order])

  // Página siguiente (scroll infinito): agrega al final.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return
    setLoadingMore(true)
    const next = pageRef.current + 1
    const { data } = await buildQuery().range(next * PAGE_SIZE, next * PAGE_SIZE + PAGE_SIZE - 1)
    const batch = (data as Listing[]) ?? []
    pageRef.current = next
    setListings((prev) => {
      const merged = [...prev, ...batch]
      if (feedCache) {
        feedCache.listings = merged
        feedCache.page = next
        feedCache.hasMore = batch.length === PAGE_SIZE
      }
      return merged
    })
    setHasMore(batch.length === PAGE_SIZE)
    setLoadingMore(false)
  }, [buildQuery, loadingMore, hasMore, loading])

  // Carga inicial / refetch con debounce ante cambios de filtros. En el primer
  // render con caché (volvimos de un detalle) no recargamos: preservamos las
  // páginas ya cargadas y el scroll.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      if (feedCache && !pending && listings.length) return
    }
    const timer = setTimeout(loadFirst, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFirst])

  // Scroll infinito: observer sobre el centinela al final del feed.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '600px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  // El feed se cura solo: al volver a la pestaña/app (foreground) recarga.
  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === 'visible') loadFirst()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [loadFirst])

  // Guardar la posición de scroll al salir del feed
  useEffect(() => {
    return () => {
      if (feedCache) feedCache.scrollY = window.scrollY
    }
  }, [])

  // Asegura la ubicación del comprador (la pide si hace falta).
  async function ensureLocation(): Promise<boolean> {
    if (buyerLoc) return true
    const loc = await requestBuyerLocation()
    if (!loc) return false
    setBuyerLoc(loc)
    return true
  }

  // Pill de ubicación: pide geolocalización y geocodifica para mostrar la zona.
  async function pickLocation() {
    setLocating(true)
    try {
      const loc = await requestBuyerLocation()
      if (!loc) return
      setBuyerLoc(loc)
      const label = await reverseGeocode(loc)
      if (label) {
        setBuyerLabel(label)
        cacheBuyerLabel(label)
      }
    } finally {
      setLocating(false)
    }
  }

  // Distancia por publicación (para el chip). Si hay radio activo, filtra por
  // cercanía y ordena por distancia. Todo en el cliente.
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

  // Campos filtrables de la categoría elegida (select/boolean).
  const categoryFieldDefs = useMemo(
    () => filterableFields(categories.find((c) => c.id === categoryId)?.required_fields),
    [categories, categoryId],
  )
  // Al cambiar de categoría, los filtros de campo de la anterior ya no aplican.
  const firstCat = useRef(true)
  useEffect(() => {
    if (firstCat.current) {
      firstCat.current = false
      return
    }
    setFilters((f) => (Object.keys(f.fields).length ? { ...f, fields: {} } : f))
  }, [categoryId])

  const activeFilters = countActiveFilters(filters)
  const canSaveSearch = Boolean(search.trim()) || activeFilters > 0 || categoryId !== null

  useEffect(() => {
    setSavedSearch(false)
  }, [search, categoryId, filters])

  async function saveSearch() {
    if (!session) return navigate('/auth', { state: { from: '/', back: '/' } })
    const { error } = await supabase.from('saved_searches').insert({
      user_id: session.user.id,
      query: search.trim() || null,
      category_id: categoryId,
      min_price: filters.priceMin ? Number(filters.priceMin) : null,
      max_price: filters.priceMax ? Number(filters.priceMax) : null,
      currency: filters.currency === 'all' ? null : filters.currency,
      conditions: filters.conditions.length ? filters.conditions : null,
    })
    if (!error) setSavedSearch(true)
  }

  // Pull-to-refresh: si arrancás el gesto con el feed arriba de todo y tirás
  // hacia abajo más allá del umbral, recarga. No usa preventDefault (no
  // interfiere con scroll/taps).
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pullStart = useRef<number | null>(null)

  function onTouchStart(e: ReactTouchEvent) {
    pullStart.current = window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : null
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (pullStart.current === null) return
    const delta = e.touches[0].clientY - pullStart.current
    setPull(delta > 0 && window.scrollY <= 0 ? Math.min(delta * 0.5, 90) : 0)
  }
  async function onTouchEnd() {
    if (pullStart.current === null) return
    pullStart.current = null
    if (pull >= 60) {
      setRefreshing(true)
      await loadFirst()
      setRefreshing(false)
    }
    setPull(0)
  }

  const showSkeleton = loading && listings.length === 0

  return (
    <div className="relative pb-28" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {(pull > 0 || refreshing) && (
        <div
          className="pointer-events-none absolute inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex justify-center"
          style={{ opacity: refreshing ? 1 : Math.min(pull / 60, 1) }}
        >
          <span
            className={`h-6 w-6 rounded-full border-2 border-neutral-600 border-t-white ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }}
          />
        </div>
      )}
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
            <Link to="/mapa" aria-label="Ver en el mapa" className="p-2 text-white">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
                <path d="M9 4v14M15 6v14" />
              </svg>
            </Link>
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
        {/* Pill de ubicación: define la zona de referencia para la cercanía */}
        <button
          onClick={pickLocation}
          disabled={locating}
          className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-400 transition active:scale-95 active:text-white disabled:opacity-70"
        >
          {locating ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-500/40 border-t-neutral-300" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          )}
          {locating ? 'Buscando ubicación…' : buyerLabel ?? 'Definí tu zona'}
        </button>
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
          onClick={() => {
            setCategoryId(null)
            setOnlyAuctions(false)
          }}
          className={`shrink-0 text-sm font-medium transition ${!categoryId && !onlyAuctions ? 'text-white' : 'text-neutral-500'}`}
        >
          Todo
        </button>
        <button
          onClick={() => {
            setOnlyAuctions(true)
            setCategoryId(null)
          }}
          className={`shrink-0 text-sm font-semibold transition ${onlyAuctions ? 'glow-text text-amber-400' : 'text-neutral-500'}`}
        >
          Subastas
        </button>
        {categories
          .filter((c) => !c.parent_id)
          .map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setCategoryId(categoryId === cat.id ? null : cat.id)
                setOnlyAuctions(false)
              }}
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

      {canSaveSearch && (
        <div className="px-4 pb-2">
          <button
            onClick={saveSearch}
            disabled={savedSearch}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-semibold transition ${
              savedSearch ? 'bg-neutral-900 text-neutral-400' : 'bg-neutral-900 text-white ring-1 ring-neutral-800 active:bg-neutral-800'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {savedSearch ? <path d="M20 6 9 17l-5-5" /> : <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>}
            </svg>
            {savedSearch ? 'Búsqueda guardada · te avisamos' : 'Guardar búsqueda con alerta'}
          </button>
        </div>
      )}

      {/* Subastas destacadas + vistos recientemente: solo en la vista por defecto */}
      {defaultView && featuredAuctions.length > 0 && (
        <div className="px-4 pb-3 pt-1">
          <AuctionRail listings={featuredAuctions} />
        </div>
      )}
      {defaultView && recentItems.length > 0 && (
        <div className="px-4 pb-3 pt-1">
          <ListingRail title="Vistos recientemente" listings={recentItems} />
        </div>
      )}

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

      {/* Centinela del scroll infinito + spinner */}
      {!showSkeleton && hasMore && !filters.radiusKm && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {loadingMore && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
        </div>
      )}

      {filtersOpen && (
        <FeedFilters
          value={filters}
          onApply={setFilters}
          ensureLocation={ensureLocation}
          categoryFields={categoryFieldDefs}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}
