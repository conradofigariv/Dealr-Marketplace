import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { capture, identifyUser, resetAnalytics } from '../lib/analytics'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  profileError: string | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  profileError: null,
  loading: true,
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)

  async function loadProfile(userId: string) {
    setProfileError(null)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (data) {
      setProfile(data)
      identifyUser(data.id, { username: data.username })
      return
    }
    // Cuenta sin fila en profiles (creada antes del trigger handle_new_user):
    // la creamos desde acá con el username provisorio, igual que el trigger.
    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({ id: userId, username: `usuario_${userId.slice(0, 8)}` })
      .select('*')
      .single()
    if (created) {
      setProfile(created)
      return
    }
    // El mensaje crudo se muestra en pantalla: es la única vía de
    // diagnóstico cuando el problema es la base (esquema sin correr, RLS).
    setProfileError((insertError ?? error)?.message ?? 'Error desconocido al cargar el perfil')
  }

  useEffect(() => {
    if (!supabaseConfigured) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (newSession) {
        loadProfile(newSession.user.id)
        if (event === 'SIGNED_IN') capture('logged_in')
      } else {
        setProfile(null)
        if (event === 'SIGNED_OUT') resetAnalytics()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        profileError,
        loading,
        refreshProfile: async () => {
          if (session) await loadProfile(session.user.id)
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
