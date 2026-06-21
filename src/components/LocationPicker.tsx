import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { TILE_URL, TILE_ATTRIBUTION } from './leafletSetup'
import { CORDOBA, reverseGeocode, requestBuyerLocation, type LatLng } from '../lib/geo'

// Mapa interactivo para elegir la ubicación al publicar: pin arrastrable,
// click para mover y botón "usar mi ubicación". Al soltar el pin geocodifica
// (con debounce) para mostrar el barrio/zona.
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

  async function useMyLocation() {
    const loc = await requestBuyerLocation()
    if (loc) emit(loc)
  }

  return (
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
  )
}
