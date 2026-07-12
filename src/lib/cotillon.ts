import { supabase } from './supabase'

// Easter egg privado: dos usuarios (los dueños) pueden mandarse la animación
// de "cotillón" (el confeti + fanfarria de cuando alguien publica) el uno al
// otro desde Configuración. Va por Realtime broadcast en un canal compartido:
// el que aprieta el botón dispara, el otro lo recibe si tiene la app abierta
// (efímero, sin persistencia — si no está online, se lo pierde y listo).

// Emails habilitados (en minúscula). Solo estos ven el botón y reciben el
// cotillón. Si cambian, editar acá.
const COTILLON_EMAILS = ['aninunez425@gmail.com', 'conradofigari.v@gmail.com']

const CHANNEL = 'cotillon'

export function canUseCotillon(email: string | null | undefined): boolean {
  return !!email && COTILLON_EMAILS.includes(email.toLowerCase())
}

// UN SOLO canal por cliente (singleton). Supabase-js no deja suscribirse dos
// veces al mismo topic: si el emisor creaba un segundo canal 'cotillon'
// mientras el listener ya tenía el suyo, el `.subscribe()` nunca disparaba
// 'SUBSCRIBED' y el botón quedaba girando para siempre. Compartimos el mismo
// canal para escuchar Y enviar.
type Channel = ReturnType<typeof supabase.channel>
let channel: Channel | null = null
let ready: Promise<void> | null = null
const handlers = new Set<(fromName: string) => void>()

// Crea (una vez) el canal y devuelve una promesa que resuelve cuando quedó
// suscripto. `self: false` → el emisor no recibe su propio cotillón.
function ensureChannel(): Promise<void> {
  if (ready) return ready
  ready = new Promise((resolve, reject) => {
    channel = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'throw' }, ({ payload }) => {
      const name = (payload?.fromName as string) || 'Alguien'
      handlers.forEach((h) => h(name))
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Reintentar en la próxima llamada (no dejamos el singleton envenenado).
        ready = null
        reject(new Error('No se pudo conectar el canal'))
      }
    })
  })
  return ready
}

// Suscribe para RECIBIR cotillones. Devuelve la función de limpieza (quita el
// handler; el canal singleton queda vivo para toda la sesión).
export function listenCotillon(onThrow: (fromName: string) => void): () => void {
  handlers.add(onThrow)
  ensureChannel().catch(() => {
    /* si falla, se reintenta al próximo listen/send */
  })
  return () => {
    handlers.delete(onThrow)
  }
}

// Manda el cotillón al otro. Espera a que el canal esté suscripto (con un tope
// de tiempo para no colgar el botón si Realtime no responde). `fromName` es
// cómo se muestra en el toast del que lo recibe.
export async function sendCotillon(fromName: string): Promise<void> {
  await Promise.race([
    ensureChannel(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Realtime no respondió a tiempo')), 5000),
    ),
  ])
  const res = await channel!.send({ type: 'broadcast', event: 'throw', payload: { fromName } })
  if (res !== 'ok') throw new Error('No se pudo enviar el cotillón')
}
