import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { TILE_URL_LIGHT, TILE_ATTRIBUTION } from './leafletSetup'
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
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
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
    L.tileLayer(TILE_URL_LIGHT, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)

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
    // ajusta layout, o dentro de un Modal que anima su entrada): recálculo
    // inicial + ResizeObserver para cualquier cambio posterior.
    setTimeout(() => map.invalidateSize(), 0)
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null
    if (ro && containerRef.current) ro.observe(containerRef.current)

    return () => {
      clearTimeout(geocodeTimer.current)
      ro?.disconnect()
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

  // Al entrar/salir de pantalla completa, el contenedor cambia de tamaño:
  // recalculamos (el ResizeObserver también, pero forzamos por las dudas).
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 60)
    return () => clearTimeout(t)
  }, [fullscreen])

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
    if (locating) return
    setLocating(true)
    setLocError('')
    const loc = await requestBuyerLocation()
    if (!loc) {
      setLocating(false)
      setLocError('No pudimos obtener tu ubicación. Revisá los permisos de ubicación del navegador.')
      return
    }
    // Movemos el mapa al toque y luego buscamos la dirección para completarla.
    mapRef.current?.setView([loc.lat, loc.lng], 16)
    markerRef.current?.setLatLng([loc.lat, loc.lng])
    onChangeRef.current(loc)
    const label = await reverseGeocode(loc)
    if (label) {
      onChangeRef.current(loc, label)
      pickedRef.current = label
      setQuery(label)
    }
    setLocating(false)
  }

  async function runSearch() {
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
    // En pantalla completa, el componente entero pasa a un overlay fijo (el
    // buscador sigue arriba, usable) y el mapa ocupa el resto.
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-[900] flex flex-col bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]'
          : ''
      }
    >
      {/* OJO: NO usar <form> acá. Este componente se monta dentro del <form> del
          wizard de Publicar, y un form anidado es HTML inválido → el submit de
          "Buscar"/Enter terminaba enviando el form de afuera y saltaba de paso.
          Por eso "Buscar" es type=button y Enter hace preventDefault + busca. */}
      <div className="relative mb-2">
        <div className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 ring-1 ring-neutral-800 focus-within:ring-neutral-600">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // no enviar el form del wizard
                runSearch()
              }
            }}
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
          <button type="button" onClick={runSearch} disabled={searching} className="shrink-0 text-sm font-semibold text-white disabled:opacity-40">
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
      </div>

      <div className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-neutral-300 ${fullscreen ? 'flex-1' : ''}`}>
        <div ref={containerRef} className={`w-full bg-neutral-200 ${fullscreen ? 'h-full' : 'h-56'}`} />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="absolute right-3 top-3 z-[400] flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm disabled:opacity-80"
        >
          {locating ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          )}
          {locating ? 'Buscando…' : 'Usar mi ubicación'}
        </button>
        {/* Expandir a pantalla completa (solo cuando NO está expandido; cuando
            lo está, se cierra con el botón "Listo" de abajo). */}
        {!fullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="Pantalla completa"
            className="absolute bottom-3 right-3 z-[400] flex h-9 w-9 items-center justify-center rounded-full bg-black/75 text-white backdrop-blur-sm"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        )}
        <p className="pointer-events-none absolute bottom-2 left-3 z-[400] rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
          Tocá el mapa o arrastrá el pin para ajustar
        </p>
      </div>
      {fullscreen && (
        <button
          type="button"
          onClick={() => setFullscreen(false)}
          className="btn-primary mt-3 shrink-0"
        >
          Listo
        </button>
      )}
      {locError && <p className="mt-2 text-xs text-amber-400">{locError}</p>}
    </div>
  )
}
