import { createClient } from '@supabase/supabase-js'

// Normaliza la URL: comillas pegadas por error y barras o espacios de más al
// final (típico al copiar y pegar en Vercel) hacen que cada request salga
// con // o con comillas y la API responda "Invalid path specified in
// request URL".
function clean(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '').trim()
}

const rawUrl = clean(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)

/** false cuando faltan las env vars: la app muestra la pantalla de setup. */
export const supabaseConfigured = Boolean(rawUrl && anonKey)

/** La URL configurada no apunta a la API del proyecto (p. ej. se pegó la del dashboard). */
export const supabaseUrlInvalid = Boolean(
  rawUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(rawUrl),
)

/** Valor crudo recibido en el build, para mostrarlo en la pantalla de setup.
 * No es secreto: la URL del proyecto viaja en el bundle de todas formas. */
export const supabaseUrlConfigured = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '(vacía)'

export const supabase = createClient(
  rawUrl ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-key',
)

export function photoUrl(path: string): string {
  // Un avatar de Google (u otra URL absoluta) se usa tal cual; solo las rutas
  // de Storage se resuelven al bucket. Las fotos de listing nunca son URLs
  // absolutas, así que este passthrough no las afecta.
  if (/^https?:\/\//i.test(path)) return path
  return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl
}

// URL de la miniatura de una foto (para el feed). Convención: la misma ruta
// con `.thumb.webp`. Las publicaciones viejas no tienen miniatura → el feed
// cae a la foto grande con `onError` (ver ListingCard/SmartImage). Se generan
// al publicar (ver images.ts::compressThumb).
export function thumbUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return photoUrl(path.replace(/\.webp$/i, '.thumb.webp'))
}
