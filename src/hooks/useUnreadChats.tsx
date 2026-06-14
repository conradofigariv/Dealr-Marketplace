import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

interface UnreadChatsState {
  count: number
  refresh: () => Promise<void>
}

const UnreadChatsContext = createContext<UnreadChatsState>({
  count: 0,
  refresh: async () => {},
})

export function UnreadChatsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!session) {
      setCount(0)
      return
    }
    // RLS ya limita messages a mis conversaciones; cuento los entrantes sin leer.
    const { count: c } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .neq('sender_id', session.user.id)
    setCount(c ?? 0)
  }, [session])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Recontar ante cualquier mensaje nuevo o marcado como leído.
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel(`unread-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, refresh)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, refresh])

  return <UnreadChatsContext.Provider value={{ count, refresh }}>{children}</UnreadChatsContext.Provider>
}

export function useUnreadChats() {
  return useContext(UnreadChatsContext)
}
