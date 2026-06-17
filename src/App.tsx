import { lazy, Suspense, Component, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation, useNavigationType, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { FavoritesProvider } from './hooks/useFavorites'
import { NotificationsProvider } from './hooks/useNotifications'
import { UnreadChatsProvider } from './hooks/useUnreadChats'
import { supabaseConfigured, supabaseUrlInvalid, supabaseUrlConfigured } from './lib/supabase'
import { hasSeenWelcome } from './lib/welcome'
import { capturePageview } from './lib/analytics'
import BottomNav from './components/BottomNav'
import UpdatePrompt from './components/UpdatePrompt'
import Home from './pages/Home'

// Tras un deploy, el navegador puede tener cacheado un index.html que
// referencia chunks que ya no existen: el import dinámico falla y sin
// boundary la pantalla queda negra. Recargamos una vez para tomar la
// versión nueva; si el error persiste, ofrecemos recargar a mano.
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    const chunkError = /dynamically imported module|loading chunk|import/i.test(error.message)
    if (chunkError && !sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1')
      window.location.reload()
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">Dealr</h1>
          <p className="text-sm text-neutral-400">Algo salió mal al cargar esta pantalla.</p>
          <button
            onClick={() => {
              sessionStorage.removeItem('chunk-reload')
              window.location.reload()
            }}
            className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black"
          >
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Code-splitting: el feed carga al instante, el resto bajo demanda
const Auth = lazy(() => import('./pages/Auth'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const ListingDetail = lazy(() => import('./pages/ListingDetail'))
const Publish = lazy(() => import('./pages/Publish'))
const Chats = lazy(() => import('./pages/Chats'))
const ChatThread = lazy(() => import('./pages/ChatThread'))
const Profile = lazy(() => import('./pages/Profile'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Saved = lazy(() => import('./pages/Saved'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Explorar = lazy(() => import('./pages/Explorar'))
const SavedSearches = lazy(() => import('./pages/SavedSearches'))

// Captura un $pageview en cada cambio de ruta (PostHog no lo hace solo en SPA).
function PageviewTracker() {
  const location = useLocation()
  useEffect(() => {
    capturePageview(location.pathname)
  }, [location.pathname])
  return null
}

function Shell() {
  const location = useLocation()
  const navType = useNavigationType()
  const { profile, session } = useAuth()

  // Primera apertura de la app: la bienvenida/login es lo primero que se ve,
  // pero no es obligatoria. Solo intercepta el feed ("/"); los deep links a
  // una publicación compartida se abren sin fricción. No espera a `loading`
  // para evitar un parpadeo del feed (quien ya tiene sesión ya vio la
  // bienvenida, así que la bandera está puesta).
  if (!session && location.pathname === '/' && !hasSeenWelcome()) {
    return <Navigate to="/auth" replace state={{ from: '/', back: '/' }} />
  }

  // Recién registrado con username autogenerado: primero elige su nombre
  if (profile && /^usuario_[0-9a-f]{8}$/.test(profile.username)) {
    return <Navigate to="/onboarding" replace />
  }
  // El hilo de chat y el detalle manejan sus propias acciones a pantalla completa
  const hideNav = /^\/(chats|p)\/.+/.test(location.pathname)
  // Volver (POP) entra desde la izquierda; avanzar, desde la derecha (iOS).
  const pageAnim = navType === 'POP' ? 'page-pop' : 'page-push'
  return (
    <div className="mx-auto min-h-dvh max-w-lg overflow-x-hidden bg-black">
      <Suspense fallback={<div className="min-h-dvh bg-black" />}>
        <div key={location.pathname} className={pageAnim}>
          <Outlet />
        </div>
      </Suspense>
      {!hideNav && <BottomNav />}
    </div>
  )
}

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-10 text-center">
      <h1 className="text-5xl font-bold tracking-tight text-white">Dealr</h1>
      {supabaseUrlInvalid ? (
        <>
          <p className="text-sm text-neutral-400">
            La variable{' '}
            <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">VITE_SUPABASE_URL</code>{' '}
            no apunta a la API del proyecto. Tiene que ser la <strong className="text-white">Project URL</strong>{' '}
            (Supabase → Settings → API), con la forma{' '}
            <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">https://xxxx.supabase.co</code>{' '}
            — no la URL del dashboard.
          </p>
          <p className="text-xs text-neutral-500">
            Valor actual en este build:
            <br />
            <code className="break-all rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-300">{supabaseUrlConfigured}</code>
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-400">
          Faltan las variables de entorno de Supabase. Configurá{' '}
          <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">VITE_SUPABASE_URL</code> y{' '}
          <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">VITE_SUPABASE_ANON_KEY</code>{' '}
          (ver <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">.env.example</code>) y recargá.
        </p>
      )}
    </div>
  )
}

export default function App() {
  // La app cargó bien: re-armar la recarga automática para el próximo deploy
  useEffect(() => {
    sessionStorage.removeItem('chunk-reload')
  }, [])
  if (!supabaseConfigured || supabaseUrlInvalid) return <SetupNotice />
  return (
    <ErrorBoundary>
      <AuthProvider>
        <FavoritesProvider>
        <NotificationsProvider>
        <UnreadChatsProvider>
        <BrowserRouter>
        <PageviewTracker />
        <UpdatePrompt />
        <Routes>
          <Route
            path="/auth"
            element={
              <Suspense fallback={<div className="min-h-dvh bg-black" />}>
                <Auth />
              </Suspense>
            }
          />
          <Route
            path="/onboarding"
            element={
              <Suspense fallback={<div className="min-h-dvh bg-black" />}>
                <Onboarding />
              </Suspense>
            }
          />
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/p/:id" element={<ListingDetail />} />
            <Route path="/publicar" element={<Publish />} />
            <Route path="/publicar/:id" element={<Publish />} />
            <Route path="/chats" element={<Chats />} />
            <Route path="/chats/:id" element={<ChatThread />} />
            <Route path="/perfil" element={<Profile />} />
            <Route path="/u/:username" element={<PublicProfile />} />
            <Route path="/opiniones" element={<Feedback />} />
            <Route path="/guardados" element={<Saved />} />
            <Route path="/notificaciones" element={<Notifications />} />
            <Route path="/explorar" element={<Explorar />} />
            <Route path="/busquedas" element={<SavedSearches />} />
          </Route>
        </Routes>
        </BrowserRouter>
        </UnreadChatsProvider>
        </NotificationsProvider>
        </FavoritesProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
