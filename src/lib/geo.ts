// Utilidades de ubicación: distancia entre puntos, formato legible,
// "difuminado" del punto exacto para mostrar un área aproximada (privacidad,
// estilo Facebook Marketplace), geocoding inverso con Nominatim (OSM) y
// caché de la ubicación del comprador para el "cerca tuyo" del feed.

export interface LatLng {
  lat: number
  lng: number
}

// Centro de Córdoba: fallback cuando no hay ubicación del usuario.
export const CORDOBA: LatLng = { lat: -31.4201, lng: -64.1888 }

const EARTH_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Distancia en km entre dos puntos (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h))
}

/** "a 300 m" / "a 3,4 km" / "a 12 km" (con coma decimal es-AR). */
export function formatDistance(km: number): string {
  if (km < 1) {
    const m = Math.max(1, Math.round(km * 10)) * 100 // redondeo a 100 m
    return `a ${m} m`
  }
  if (km < 10) return `a ${km.toFixed(1).replace('.', ',')} km`
  return `a ${Math.round(km)} km`
}

// Hash estable de un string -> entero positivo. Sirve para que el
// difuminado del punto sea siempre el mismo para una misma publicación.
function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Radio del círculo aproximado que se dibuja en el detalle (metros). */
export const APPROX_RADIUS_M = 700

/**
 * Centro corrido de forma determinística (150–400 m) a partir del id de la
 * publicación. El punto real queda DENTRO del círculo pero no es su centro,
 * así no se expone la ubicación exacta.
 */
export function approxCenter(point: LatLng, seed: string): LatLng {
  const h = hashSeed(seed)
  const angle = (h % 360) * (Math.PI / 180)
  const distKm = 0.15 + ((h >> 9) % 100) / 100 * 0.25 // 0,15–0,40 km
  const dLat = (distKm / 111) * Math.cos(angle)
  const dLng = (distKm / (111 * Math.cos(toRad(point.lat)))) * Math.sin(angle)
  return { lat: point.lat + dLat, lng: point.lng + dLng }
}

/**
 * Geocoding inverso con Nominatim (OSM, gratis). Devuelve una etiqueta corta
 * tipo "Nueva Córdoba, Córdoba". El navegador manda el Referer del sitio, que
 * alcanza para la política de uso a bajo volumen. Si falla, devuelve null.
 */
export async function reverseGeocode({ lat, lng }: LatLng): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=es`,
    )
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address ?? {}
    const local = a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.county
    const city = a.city || a.town || a.state
    const parts = [local, city].filter(Boolean)
    const unique = parts.filter((v, i) => parts.indexOf(v) === i)
    if (unique.length) return unique.join(', ')
    return (data.display_name as string | undefined)?.split(',').slice(0, 2).join(',').trim() ?? null
  } catch {
    return null
  }
}

/**
 * Geocoding directo: busca una ciudad/dirección por texto y devuelve hasta 8
 * coincidencias (Nominatim, OSM). Sesgado a Argentina. Sirve para publicar algo
 * que no está donde estás parado (ej. un alquiler en otra ciudad).
 *
 * Si se pasa `near` (la ubicación actual del usuario o del pin), ordena los
 * resultados por cercanía a ese punto: así al escribir "crisol 51" aparece
 * primero la coincidencia más próxima (Córdoba, si estás ahí) antes que otras
 * ciudades con la misma calle.
 */
export interface GeocodeResult extends LatLng {
  label: string
}

export async function geocodeSearch(query: string, near?: LatLng | null): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}` +
        `&countrycodes=ar&accept-language=es&limit=8&addressdetails=1`,
    )
    if (!res.ok) return []
    const data = (await res.json()) as Array<{
      lat: string
      lon: string
      display_name: string
      address?: Record<string, string>
    }>
    const results = data.map((d) => {
      const a = d.address ?? {}
      const local = a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.city || a.county
      const region = a.state || a.province
      const parts = [local, region].filter(Boolean)
      const unique = parts.filter((v, i) => parts.indexOf(v) === i)
      return {
        lat: Number(d.lat),
        lng: Number(d.lon),
        label: unique.length ? unique.join(', ') : d.display_name.split(',').slice(0, 2).join(',').trim(),
      }
    })
    // Más cercano primero (si tenemos un punto de referencia).
    if (near) results.sort((a, b) => haversineKm(near, a) - haversineKm(near, b))
    return results
  } catch {
    return []
  }
}

// ---------- Ubicación del comprador (para el "cerca tuyo") ----------
const BUYER_LOC_KEY = 'dealr_buyer_loc'

export function getCachedBuyerLocation(): LatLng | null {
  try {
    const raw = localStorage.getItem(BUYER_LOC_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v?.lat === 'number' && typeof v?.lng === 'number') return v
  } catch {
    /* localStorage no disponible */
  }
  return null
}

export function cacheBuyerLocation(loc: LatLng) {
  try {
    localStorage.setItem(BUYER_LOC_KEY, JSON.stringify(loc))
  } catch {
    /* ignorar */
  }
}

/** Pide la ubicación al navegador (una vez), la cachea y la devuelve. */
export function requestBuyerLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        cacheBuyerLocation(loc)
        resolve(loc)
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

// Etiqueta legible de la zona del comprador (para el pill del header).
const BUYER_LABEL_KEY = 'dealr_buyer_label'

export function getCachedBuyerLabel(): string | null {
  try {
    return localStorage.getItem(BUYER_LABEL_KEY)
  } catch {
    return null
  }
}

export function cacheBuyerLabel(label: string) {
  try {
    localStorage.setItem(BUYER_LABEL_KEY, label)
  } catch {
    /* ignorar */
  }
}

// ---------- Vistos recientemente ----------
const RECENT_KEY = 'dealr_recent_views'
const RECENT_MAX = 12

export function getRecentlyViewed(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function pushRecentlyViewed(id: string) {
  try {
    const list = getRecentlyViewed().filter((x) => x !== id)
    list.unshift(id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    /* ignorar */
  }
}
