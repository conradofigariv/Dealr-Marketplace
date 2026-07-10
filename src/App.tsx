import { lazy, Suspense, Component, useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation, useNavigationType, useNavigate, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { FavoritesProvider } from './hooks/useFavorites'
import { NotificationsProvider } from './hooks/useNotifications'
import { UnreadChatsProvider } from './hooks/useUnreadChats'
import { supabase, supabaseConfigured, supabaseUrlInvalid, supabaseUrlConfigured } from './lib/supabase'
import { hasSeenWelcome } from './lib/welcome'
import { hasSeenIntro, REPLAY_INTRO_EVENT } from './lib/intro'
import './lib/pwaInstall' // registra el listener de instalación temprano
import { capturePageview } from './lib/analytics'
import { haptic } from './lib/notify'
import BottomNav from './components/BottomNav'
import UpdatePrompt from './components/UpdatePrompt'
import IntroSlides from './components/IntroSlides'
import TermsModal from './components/TermsModal'
import { ToastProvider } from './components/Toast'
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
const MapView = lazy(() => import('./pages/MapView'))
const Admin = lazy(() => import('./pages/Admin'))

// Captura un $pageview en cada cambio de ruta (PostHog no lo hace solo en SPA).
function PageviewTracker() {
  const location = useLocation()
  useEffect(() => {
    capturePageview(location.pathname)
  }, [location.pathname])
  return null
}

// Pestañas navegables con swipe, en el orden de la barra. "Vender" (/publicar)
// queda afuera a propósito: es un formulario — entrar por accidente molesta y
// salir por accidente pierde lo cargado. A esa se llega tocando.
const SWIPE_TABS = ['/', '/explorar', '/chats', '/perfil']

function Shell() {
  const location = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const { profile, session, refreshProfile } = useAuth()
  const [showIntro, setShowIntro] = useState(false)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)

  // Swipe horizontal entre secciones de la barra: deslizar a la izquierda va a
  // la pestaña siguiente (entra desde la derecha) y viceversa — la animación
  // acompaña el lado hacia el que efectivamente te movés.
  function onTabTouchStart(e: ReactTouchEvent) {
    swipeRef.current = null
    if (!SWIPE_TABS.includes(location.pathname)) return
    const t = e.target as HTMLElement
    // No arrancar el gesto donde ya hay interacción horizontal u overlays:
    // filas/rieles con scroll horizontal, mapas Leaflet, inputs y capas fixed
    // (modales, intro, viewers) — ahí el swipe significa otra cosa.
    if (t.closest('.overflow-x-auto, .leaflet-container, input, textarea, .fixed')) return
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function onTabTouchEnd(e: ReactTouchEvent) {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    // Horizontal franco: mínimo 70px y al menos el doble que lo vertical.
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return
    const idx = SWIPE_TABS.indexOf(location.pathname)
    if (idx === -1) return
    const next = dx < 0 ? idx + 1 : idx - 1
    if (next < 0 || next >= SWIPE_TABS.length) return
    haptic('tap')
    navigate(SWIPE_TABS[next], { state: { tabDir: dx < 0 ? 'push' : 'pop' } })
  }

  // Onboarding de funciones (3 slides): una vez, apenas hay sesión.
  useEffect(() => {
    if (session && !hasSeenIntro()) setShowIntro(true)
  }, [session])

  // El moderador puede re-disparar el onboarding desde su perfil (replayIntro).
  useEffect(() => {
    const onReplay = () => setShowIntro(true)
    window.addEventListener(REPLAY_INTRO_EVENT, onReplay)
    return () => window.removeEventListener(REPLAY_INTRO_EVENT, onReplay)
  }, [])

  // Precarga los chunks de las páginas en segundo plano (cuando la app está
  // ociosa). Sin esto, la PRIMERA navegación a cada página baja su chunk y
  // Suspense muestra una pantalla negra que corta la animación de slide
  // ("freeze"). Precargados, navegar es instantáneo y la transición fluye.
  useEffect(() => {
    const preload = () => {
      void import('./pages/ListingDetail')
      void import('./pages/ChatThread')
      void import('./pages/Chats')
      void import('./pages/Profile')
      void import('./pages/Explorar')
      void import('./pages/Notifications')
      void import('./pages/Saved')
      void import('./pages/Publish')
      void import('./pages/MapView')
      void import('./pages/PublicProfile')
      void import('./pages/Auth')
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback
    if (ric) {
      ric(preload, { timeout: 3000 })
      return
    }
    const t = setTimeout(preload, 1500)
    return () => clearTimeout(t)
  }, [])

  // Primera apertura de la app: la bienvenida/login es lo primero que se ve,
  // pero no es obligatoria. Solo intercepta el feed ("/"); los deep links a
  // una publicación compartida se abren sin fricción. No espera a `loading`
  // para evitar un parpadeo del feed (quien ya tiene sesión ya vio la
  // bienvenida, así que la bandera está puesta).
  if (!session && location.pathname === '/' && !hasSeenWelcome()) {
    return <Navigate to="/auth" replace state={{ from: '/', back: '/' }} />
  }

  // Términos y Condiciones: bloquea la app hasta aceptar (va ANTES del onboarding
  // de username). Como el auth es magic link / Google, la cuenta ya existe al
  // llegar acá, así que "Rechazar" cierra sesión y vuelve al login.
  if (profile && !profile.terms_accepted_at) {
    return (
      <TermsModal
        onAccept={async () => {
          await supabase.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', profile.id)
          await refreshProfile()
        }}
        onReject={async () => {
          await supabase.auth.signOut()
          navigate('/auth', { replace: true })
        }}
      />
    )
  }

  // Recién registrado con username autogenerado: primero elige su nombre
  if (profile && /^usuario_[0-9a-f]{8}$/.test(profile.username)) {
    return <Navigate to="/onboarding" replace />
  }
  // El hilo de chat, el detalle y el mapa manejan su propio chrome a pantalla completa
  const hideNav = /^\/(chats|p)\/.+/.test(location.pathname) || location.pathname === '/mapa'
  // Volver (POP) entra desde la izquierda; avanzar, desde la derecha (iOS).
  // Si la navegación trae dirección explícita (swipe o tap de pestaña), manda
  // esa — pero NUNCA en un POP del historial: ahí el state es el guardado de
  // la visita anterior y usarlo animaría para el lado equivocado.
  const tabDir = navType !== 'POP' ? (location.state as { tabDir?: 'push' | 'pop' } | null)?.tabDir : undefined
  const pageAnim = (tabDir ?? (navType === 'POP' ? 'pop' : 'push')) === 'pop' ? 'page-pop' : 'page-push'
  // En DESKTOP (lg+) solo el feed se ensancha para respirar; el resto queda en la
  // columna angosta de siempre. Mobile no cambia (las clases base son idénticas).
  const isFeed = location.pathname === '/'
  return (
    <div
      className={`mx-auto min-h-dvh overflow-x-hidden bg-black max-w-lg ${isFeed ? 'lg:max-w-4xl' : ''}`}
      onTouchStart={onTabTouchStart}
      onTouchEnd={onTabTouchEnd}
    >
      <Suspense fallback={<div className="min-h-dvh bg-black" />}>
        <div key={location.pathname} className={pageAnim}>
          <Outlet />
        </div>
      </Suspense>
      {!hideNav && <BottomNav />}
      {showIntro && <IntroSlides onDone={() => setShowIntro(false)} />}
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
    // Limpiar el badge de notificaciones al abrir la app
    if ('clearAppBadge' in navigator) navigator.clearAppBadge()
  }, [])
  if (!supabaseConfigured || supabaseUrlInvalid) return <SetupNotice />
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
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
            <Route path="/mapa" element={<MapView />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
        </BrowserRouter>
        </UnreadChatsProvider>
        </NotificationsProvider>
        </FavoritesProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
