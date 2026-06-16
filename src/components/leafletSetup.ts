// Configuración común de Leaflet: CSS, arreglo del ícono por defecto (las
// rutas de las imágenes se rompen con bundlers como Vite) y los tiles.
// Usamos los tiles oscuros de CARTO para que el mapa combine con el tema
// negro de Dealr. Gratis, con atribución a OSM + CARTO.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
export const TILE_ATTRIBUTION = '© OpenStreetMap · © CARTO'
