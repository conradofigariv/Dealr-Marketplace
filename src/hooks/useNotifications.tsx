import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { alertIncoming } from '../lib/notify'
import type { AppNotification } from '../lib/types'

interface NotificationsState {
  items: AppNotification[]
  unreadCount: number
  markAllRead: () => Promise<void>
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsState>({
  items: [],
  unreadCount: 0,
  markAllRead: async () => {},
  refresh: async () => {},
})

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [items, setItems] = useState<AppNotification[]>([])
  // Ids ya alertados, para no sonar dos veces (StrictMode / reentregas).
  const alertedRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!session) {
      setItems([])
      return
    }
    // Con el embed del actor (FK de la 00023). Si esa migración no está aplicada,
    // PostgREST no encuentra la FK y la consulta ENTERA falla → caería en cero
    // notificaciones. Por eso, si el embed da error, reintentamos sin él (el
    // panel funciona igual, solo sin el avatar del que la disparó).
    // Los mensajes NO van en la campanita: ya tienen su propio contador en la
    // barra de abajo (useUnreadChats) y verlos acá duplicaba la notificación.
    const withActor = await supabase
      .from('notifications')
      .select('*, actor:profiles!notifications_actor_id_fkey(id, username, avatar_url)')
      .neq('type', 'message')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!withActor.error) {
      setItems((withActor.data as AppNotification[]) ?? [])
      return
    }
    const plain = await supabase
      .from('notifications')
      .select('*')
      .neq('type', 'message')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!plain.error) setItems((plain.data as AppNotification[]) ?? [])
  }, [session])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime: las notificaciones nuevas aparecen sin recargar.
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel(`notifications-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` },
        async (payload) => {
          const n = payload.new as AppNotification
          if (!alertedRef.current.has(n.id)) {
            alertedRef.current.add(n.id)
            // Sonido + vibración + globo (si la pestaña no está visible).
            alertIncoming(n.title, n.body, n.link)
          }
          // Los mensajes no entran a la campanita (los maneja el badge del chat).
          if (n.type === 'message') return
          // El payload de Realtime no trae el embed: buscamos el avatar del
          // actor aparte para mostrarlo en vivo (no solo al recargar).
          if (n.actor_id) {
            const { data } = await supabase
              .from('profiles')
              .select('id, username, avatar_url')
              .eq('id', n.actor_id)
              .maybeSingle()
            if (data) n.actor = data
          }
          setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [session])

  const markAllRead = useCallback(async () => {
    if (!session) return
    const now = new Date().toISOString()
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    await supabase.from('notifications').update({ read_at: now }).in('id', unreadIds)
  }, [items, session])

  const unreadCount = items.reduce((acc, n) => acc + (n.read_at ? 0 : 1), 0)

  return (
    <NotificationsContext.Provider value={{ items, unreadCount, markAllRead, refresh }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationsContext)
}
