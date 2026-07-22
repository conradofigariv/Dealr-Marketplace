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
// Tile CLARO (CARTO Voyager): calles y nombres bien legibles. Solo para el
// selector de ubicación al publicar (LocationPicker), donde importa elegir con
// precisión. El resto de los mapas (detalle, MapView) siguen con el oscuro
// para no romper el tema de la app.
export const TILE_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
export const TILE_ATTRIBUTION = '© OpenStreetMap · © CARTO'
