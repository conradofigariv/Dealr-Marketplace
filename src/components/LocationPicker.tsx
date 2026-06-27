import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import { TILE_URL, TILE_ATTRIBUTION } from './leafletSetup'
import { CORDOBA, reverseGeocode, requestBuyerLocation, geocodeSearch, getCachedBuyerLocation, type LatLng, type GeocodeResult } from '../lib/geo'

// Mapa interactivo para elegir la ubicación al publicar: buscador de ciudad/
// dirección, pin arrastrable, click para mover y botón "usar mi ubicación".
// Al soltar el pin geocodifica (con debounce) para mostrar el barrio/zona.
interface Props {
  value: LatLng | null
  onChange: (loc: LatLng, label?: string) => void
}

export default function LocationPicker({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const geocodeTimer = useRef<ReturnType<typeof setTimeout>>()
  // onChange en una ref: así el efecto de init corre una sola vez sin
  // re-suscribir los handlers de Leaflet en cada render.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  // Última etiqueta elegida: evita que el autocompletado vuelva a buscar el
  // texto que acabamos de fijar al elegir un resultado.
  const pickedRef = useRef('')
  // Punto de referencia para ordenar por cercanía: el pin actual, si no la
  // ubicación cacheada del usuario, si no el centro de Córdoba.
  const nearRef = useRef<LatLng | null>(null)
  nearRef.current = value ?? getCachedBuyerLocation() ?? CORDOBA

  function emit(loc: LatLng) {
    onChangeRef.current(loc)
    clearTimeout(geocodeTimer.current)
    geocodeTimer.current = setTimeout(async () => {
      const label = await reverseGeocode(loc)
      if (label) onChangeRef.current(loc, label)
    }, 700)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start = value ?? CORDOBA
    const map = L.map(containerRef.current, {
      center: [start.lat, start.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    })
    mapRef.current = map
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)

    const marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map)
    markerRef.current = marker
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng()
      emit({ lat, lng })
    })
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng)
      emit({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    // Si no había valor previo, dejamos asentado el punto inicial (Córdoba o
    // GPS) como valor del formulario.
    if (!value) emit(start)
    // El contenedor puede montar con tamaño 0 (dentro de un form que aún
    // ajusta layout): forzamos el recálculo.
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      clearTimeout(geocodeTimer.current)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflejar cambios externos de value (ej. botón "usar mi ubicación").
  useEffect(() => {
    if (!value || !mapRef.current || !markerRef.current) return
    markerRef.current.setLatLng([value.lat, value.lng])
    mapRef.current.setView([value.lat, value.lng], mapRef.current.getZoom())
  }, [value])

  // Autocompletado: busca con debounce mientras escribís y muestra las
  // coincidencias ordenadas por cercanía (no hace falta apretar "Buscar").
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3 || q === pickedRef.current) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      const found = await geocodeSearch(q, nearRef.current)
      setResults(found)
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function useMyLocation() {
    const loc = await requestBuyerLocation()
    if (loc) emit(loc)
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 3) return
    // Búsqueda inmediata (sin esperar el debounce) al apretar Enter/Buscar.
    setSearching(true)
    const found = await geocodeSearch(q, nearRef.current)
    setResults(found)
    setSearching(false)
    // Una sola coincidencia: la aplicamos directo.
    if (found.length === 1) pick(found[0])
  }

  function pick(r: GeocodeResult) {
    const loc = { lat: r.lat, lng: r.lng }
    // Acercamos el mapa a la zona elegida y fijamos la etiqueta encontrada.
    mapRef.current?.setView([loc.lat, loc.lng], 15)
    markerRef.current?.setLatLng([loc.lat, loc.lng])
    onChangeRef.current(loc, r.label)
    clearTimeout(geocodeTimer.current)
    pickedRef.current = r.label // no re-buscar este texto en el autocompletado
    setResults([])
    setQuery(r.label)
  }

  return (
    <div>
      <form onSubmit={search} className="relative mb-2">
        <div className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 ring-1 ring-neutral-800 focus-within:ring-neutral-600">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ciudad o dirección…"
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-neutral-500 outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setResults([])
              }}
              aria-label="Limpiar"
              className="shrink-0 text-neutral-500"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
          <button type="submit" disabled={searching} className="shrink-0 text-sm font-semibold text-white disabled:opacity-40">
            {searching ? '…' : 'Buscar'}
          </button>
        </div>
        {results.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-[500] mt-1 overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-700">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition active:bg-neutral-800"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="truncate">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <div className="relative isolate overflow-hidden rounded-2xl ring-1 ring-neutral-800">
        <div ref={containerRef} className="h-56 w-full bg-neutral-900" />
        <button
          type="button"
          onClick={useMyLocation}
          className="absolute right-3 top-3 z-[400] flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Usar mi ubicación
        </button>
        <p className="pointer-events-none absolute bottom-2 left-3 z-[400] text-[11px] text-white/70 drop-shadow">
          Tocá el mapa o arrastrá el pin para ajustar
        </p>
      </div>
    </div>
  )
}
