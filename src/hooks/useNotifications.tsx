import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
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

  const refresh = useCallback(async () => {
    if (!session) {
      setItems([])
      return
    }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setItems((data as AppNotification[]) ?? [])
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
        (payload) => {
          setItems((prev) =>
            prev.some((n) => n.id === (payload.new as AppNotification).id)
              ? prev
              : [payload.new as AppNotification, ...prev],
          )
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
