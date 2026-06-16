import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { TILE_URL, TILE_ATTRIBUTION } from './leafletSetup'
import { approxCenter, APPROX_RADIUS_M, type LatLng } from '../lib/geo'

// Mapa de solo lectura para el detalle: muestra un círculo aproximado en
// lugar del punto exacto (privacidad, estilo Facebook Marketplace). El centro
// se corre de forma determinística según el id de la publicación.
interface Props {
  point: LatLng
  seed: string
}

export default function LocationMap({ point, seed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center = approxCenter(point, seed)
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
    })
    mapRef.current = map
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    L.circle([center.lat, center.lng], {
      radius: APPROX_RADIUS_M,
      color: '#ffffff',
      weight: 1.5,
      opacity: 0.6,
      fillColor: '#ffffff',
      fillOpacity: 0.12,
    }).addTo(map)
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [point, seed])

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-neutral-800">
      <div ref={containerRef} className="h-44 w-full bg-neutral-900" />
    </div>
  )
}
