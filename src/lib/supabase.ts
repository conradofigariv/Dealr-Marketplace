import { createClient } from '@supabase/supabase-js'

// Normaliza la URL: barras o espacios de más al final (típico al copiar y
// pegar en Vercel) hacen que cada request salga con // y la API responda
// "Invalid path specified in request URL".
const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** false cuando faltan las env vars: la app muestra la pantalla de setup. */
export const supabaseConfigured = Boolean(rawUrl && anonKey)

/** La URL configurada no apunta a la API del proyecto (p. ej. se pegó la del dashboard). */
export const supabaseUrlInvalid = Boolean(
  rawUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(rawUrl),
)

export const supabase = createClient(
  rawUrl ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-key',
)

export function photoUrl(path: string): string {
  return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl
}
