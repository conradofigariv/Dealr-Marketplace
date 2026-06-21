import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { TILE_URL, TILE_ATTRIBUTION } from './leafletSetup'
import { approxCenter, type LatLng } from '../lib/geo'
import type { Currency, Listing } from '../lib/types'

// Mapa con las publicaciones cercanas, estilo "ver qué se vende cerca tuyo".
// Cada publicación es una burbuja con su precio. Por privacidad se ubica en el
// centro APROXIMADO (mismo difuminado que el detalle), nunca el punto exacto.
interface Props {
  listings: Listing[]
  center: LatLng
  selectedId: string | null
  onSelect: (l: Listing) => void
}

// Precio compacto para la burbuja: "$ 350k", "$ 1,2M".
function shortPrice(price: number, currency: Currency): string {
  const sym = currency === 'USD' ? 'US$' : '$'
  if (price >= 1_000_000) {
    const m = price / 1_000_000
    return `${sym} ${m >= 10 ? Math.round(m) : m.toFixed(1).replace('.', ',')}M`
  }
  if (price >= 1_000) return `${sym} ${Math.round(price / 1000)}k`
  return `${sym} ${price}`
}

export default function ListingsMap({ listings, center, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    })
    mapRef.current = map
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // (Re)dibujar los marcadores cuando cambia la lista.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current.clear()

    listings.forEach((l) => {
      if (l.lat == null || l.lng == null) return
      const c = approxCenter({ lat: l.lat, lng: l.lng }, l.id)
      const price = l.is_auction && l.current_bid != null ? l.current_bid : l.price
      const icon = L.divIcon({
        className: '',
        html: `<div class="price-pin${l.id === selectedId ? ' price-pin-on' : ''}">${shortPrice(price, l.currency)}</div>`,
        // Sin iconSize: Leaflet dimensiona el ícono al contenido (clickeable);
        // el centrado sobre el punto lo hace el transform del .price-pin.
        iconSize: undefined,
      })
      const marker = L.marker([c.lat, c.lng], { icon }).addTo(map)
      marker.on('click', () => onSelectRef.current(l))
      markersRef.current.set(l.id, marker)
    })
  }, [listings, selectedId])

  // Resaltar el marcador seleccionado y centrarlo.
  useEffect(() => {
    if (!selectedId) return
    const marker = markersRef.current.get(selectedId)
    if (marker && mapRef.current) {
      mapRef.current.panTo(marker.getLatLng())
    }
  }, [selectedId])

  return (
    <div className="absolute inset-0 isolate">
      <div ref={containerRef} className="h-full w-full bg-neutral-900" />
    </div>
  )
}
