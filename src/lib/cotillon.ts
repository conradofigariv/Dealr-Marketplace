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

// Manda el cotillón al otro. One-shot: se suscribe, emite y se va. `fromName`
// es cómo se muestra en el toast del que lo recibe.
export function sendCotillon(fromName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // `self: false` evita que el emisor reciba su propio cotillón.
    const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      setTimeout(() => supabase.removeChannel(ch), 500)
      ok ? resolve() : reject(new Error('No se pudo enviar el cotillón'))
    }
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'throw', payload: { fromName } }).then(
          () => finish(true),
          () => finish(false),
        )
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        finish(false)
      }
    })
  })
}

// Suscribe al canal para RECIBIR cotillones. Devuelve la función de limpieza.
// `onThrow` recibe el nombre de quien lo mandó.
export function listenCotillon(onThrow: (fromName: string) => void): () => void {
  const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
  ch.on('broadcast', { event: 'throw' }, ({ payload }) => {
    onThrow((payload?.fromName as string) || 'Alguien')
  }).subscribe()
  return () => {
    supabase.removeChannel(ch)
  }
}
