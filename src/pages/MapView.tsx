import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { formatPrice } from '../lib/format'
import {
  CORDOBA,
  getCachedBuyerLocation,
  requestBuyerLocation,
  haversineKm,
  formatDistance,
  type LatLng,
} from '../lib/geo'
import type { Category, Listing } from '../lib/types'
import ListingsMap from '../components/ListingsMap'

// Vista de mapa: muestra las publicaciones activas con ubicación como burbujas
// con foto + precio. Al tocar una, aparece una tarjeta abajo con el acceso al
// detalle. Un filtro de categorías arriba acota qué se muestra.
export default function MapView() {
  const navigate = useNavigate()
  const [listings, setListings] = useState<Listing[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [center, setCenter] = useState<LatLng>(getCachedBuyerLocation() ?? CORDOBA)
  const [selected, setSelected] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Si no tenemos ubicación cacheada, la pedimos para centrar el mapa.
    if (!getCachedBuyerLocation()) {
      requestBuyerLocation().then((loc) => {
        if (loc) setCenter(loc)
      })
    }
  }, [])

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => setCategories((data ?? []).filter((c: Category) => !c.parent_id)))
  }, [])

  useEffect(() => {
    setLoading(true)
    // La categoría se filtra en la query (no client-side): así, con una
    // categoría nicho, los 300 que traemos son todos de esa categoría.
    let query = supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
    if (categoryId != null) query = query.eq('category_id', categoryId)
    query
      .order('last_renewed_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        setListings((data as Listing[]) ?? [])
        setSelected(null)
        setLoading(false)
      })
  }, [categoryId])

  const selectedDistance =
    selected && selected.lat != null && selected.lng != null && getCachedBuyerLocation()
      ? haversineKm(getCachedBuyerLocation()!, { lat: selected.lat, lng: selected.lng })
      : null

  return (
    <div className="fixed inset-0 z-10 bg-black">
      <ListingsMap listings={listings} center={center} selectedId={selected?.id ?? null} onSelect={setSelected} />

      {/* Header flotante */}
      <div className="absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-black/85 via-black/55 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19 8 12l7-7" />
            </svg>
          </button>
          <div className="rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm">
            {loading ? 'Cargando…' : `${listings.length} cerca`}
          </div>
        </div>

        {/* Filtro de categorías (scroll horizontal) */}
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <button
            onClick={() => setCategoryId(null)}
            className={`chip backdrop-blur-sm ${categoryId == null ? 'chip-on' : 'bg-black/60 text-neutral-300 ring-1 ring-white/15'}`}
          >
            Todo
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`chip backdrop-blur-sm ${categoryId === c.id ? 'chip-on' : 'bg-black/60 text-neutral-300 ring-1 ring-white/15'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tarjeta de la publicación seleccionada */}
      {selected && (
        <div className="absolute inset-x-0 bottom-0 z-[500] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="sheet-in relative flex gap-3 rounded-2xl bg-neutral-900 p-3 ring-1 ring-neutral-700">
            <button
              onClick={() => setSelected(null)}
              aria-label="Cerrar"
              className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
            <Link to={`/p/${selected.id}`} className="flex min-w-0 flex-1 gap-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                {selected.photos?.[0] && (
                  <img src={photoUrl(selected.photos[0])} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1 pr-6">
                <p className="truncate font-semibold text-white">{selected.title}</p>
                <p className="mt-0.5 text-lg font-bold text-white">
                  {formatPrice(
                    selected.is_auction && selected.current_bid != null ? selected.current_bid : selected.price,
                    selected.currency,
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {selectedDistance != null ? `${formatDistance(selectedDistance)} · ` : ''}
                  {selected.location_label ?? 'Área aproximada'}
                </p>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
