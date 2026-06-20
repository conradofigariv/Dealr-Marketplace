import type { Currency, ListingCondition, Listing } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function formatPrice(price: number, currency: Currency): string {
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(price)
  return currency === 'USD' ? `US$ ${formatted}` : `$ ${formatted}`
}

export const conditionLabels: Record<ListingCondition, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  con_detalles: 'Con detalles',
}

/** Insignia "Recién publicado": menos de 24 h. */
export function isRecentlyPosted(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < DAY_MS
}

/** % de baja si la publicación bajó de precio en los últimos 30 días (si no, null). */
export function priceDropPct(
  listing: Pick<Listing, 'price' | 'previous_price' | 'price_dropped_at'>,
): number | null {
  const prev = listing.previous_price
  if (prev == null || listing.price >= prev || !listing.price_dropped_at) return null
  if (Date.now() - new Date(listing.price_dropped_at).getTime() > 30 * DAY_MS) return null
  return Math.round((1 - listing.price / prev) * 100)
}

/** "Activo hace…" si estuvo activo en los últimos ~45 días (si no, null). */
export function lastSeenLabel(iso: string | null): string | null {
  if (!iso) return null
  if (Date.now() - new Date(iso).getTime() > 45 * DAY_MS) return null
  return `Activo ${timeAgo(iso)}`
}

/** "En línea" = tuvo actividad en los últimos 3 minutos. */
export function isOnline(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 3 * 60 * 1000
}

/** Cuenta regresiva legible para subastas: "2d 3h", "4h 12m", "5m 30s". */
export function timeLeftLabel(endIso: string, now: number = Date.now()): string {
  const ms = new Date(endIso).getTime() - now
  if (ms <= 0) return 'Finalizada'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'recién'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `hace ${days} d`
  const months = Math.floor(days / 30)
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`
  const years = Math.floor(months / 12)
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`
}
