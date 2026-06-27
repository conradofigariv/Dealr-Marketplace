import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { capture } from '../lib/analytics'
import { haptic } from '../lib/notify'

interface FavoritesState {
  ids: Set<string>
  isFavorite: (listingId: string) => boolean
  // Devuelve el nuevo estado (true = guardado) o null si no hay sesión.
  toggle: (listingId: string) => Promise<boolean | null>
}

const FavoritesContext = createContext<FavoritesState>({
  ids: new Set(),
  isFavorite: () => false,
  toggle: async () => null,
})

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [ids, setIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!session) {
      setIds(new Set())
      return
    }
    supabase
      .from('favorites')
      .select('listing_id')
      .then(({ data }) => setIds(new Set((data ?? []).map((r) => r.listing_id as string))))
  }, [session])

  const toggle = useCallback(
    async (listingId: string) => {
      if (!session) return null
      const has = ids.has(listingId)
      if (!has) haptic('tap') // toque sutil solo al guardar, no al quitar
      // Optimista: actualizamos la UI y revertimos si la red falla.
      setIds((prev) => {
        const next = new Set(prev)
        if (has) next.delete(listingId)
        else next.add(listingId)
        return next
      })
      const { error } = has
        ? await supabase.from('favorites').delete().eq('user_id', session.user.id).eq('listing_id', listingId)
        : await supabase.from('favorites').insert({ user_id: session.user.id, listing_id: listingId })
      if (error) {
        setIds((prev) => {
          const next = new Set(prev)
          if (has) next.add(listingId)
          else next.delete(listingId)
          return next
        })
        return has
      }
      if (!has) capture('listing_favorited', { listing_id: listingId })
      return !has
    },
    [ids, session],
  )

  return (
    <FavoritesContext.Provider value={{ ids, isFavorite: (id) => ids.has(id), toggle }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites() {
  return useContext(FavoritesContext)
}
