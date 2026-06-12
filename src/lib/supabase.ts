import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** false cuando faltan las env vars: la app muestra la pantalla de setup. */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-key',
)

export function photoUrl(path: string): string {
  return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl
}
