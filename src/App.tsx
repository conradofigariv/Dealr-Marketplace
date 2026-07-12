import { lazy, Suspense, Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
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
import { trackVisit } from './lib/visit'
import CotillonListener from './components/CotillonListener'
import { haptic } from './lib/notify'
import BottomNav from './components/BottomNav'
import UpdatePrompt from './components/UpdatePrompt'
import IntroSlides from './components/IntroSlides'
import TermsModal from './components/TermsModal'
import { ToastProvider } from './components/Toast'
import Home, { resetFeedScroll } from './pages/Home'

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

// Las 4 pestañas de la barra van EAGER (import estático): navegar entre ellas
// nunca pasa por Suspense — sin fallback negro ni evaluación de módulo en el
// momento del gesto, la animación de slide corre siempre. Son ~11KB gzip más
// en el bundle inicial; lo que más se usa tiene que ser instantáneo.
// (Home ya era eager.)
import Explorar from './pages/Explorar'
import Chats from './pages/Chats'
import Profile from './pages/Profile'

// Code-splitting: el resto bajo demanda
const Auth = lazy(() => import('./pages/Auth'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const ListingDetail = lazy(() => import('./pages/ListingDetail'))
const Publish = lazy(() => import('./pages/Publish'))
const ChatThread = lazy(() => import('./pages/ChatThread'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Saved = lazy(() => import('./pages/Saved'))
const Notifications = lazy(() => import('./pages/Notifications'))
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

// Swipe interactivo estilo Instagram entre las pestañas de la barra: la página
// SIGUE AL DEDO (se ven las dos a la vez) y al soltar se acomoda. "Vender"
// queda afuera (es un formulario). Las 4 páginas son eager, así que el vecino
// se monta al instante al empezar el gesto.
const TAB_ORDER = ['/', '/explorar', '/chats', '/perfil']
const TAB_COMPONENTS: Record<string, ComponentType> = {
  '/': Home,
  '/explorar': Explorar,
  '/chats': Chats,
  '/perfil': Profile,
}

interface TabDrag {
  startX: number
  startY: number
  active: boolean
  blocked: boolean
  dir: 1 | -1 // 1 = el destino está a la DERECHA (entra desde la derecha)
  off: number
  lastX: number
  lastT: number
  vx: number
  width: number
}

function Shell() {
  const location = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const { profile, session, refreshProfile } = useAuth()
  const [showIntro, setShowIntro] = useState(false)
  // Página vecina montada durante el arrastre (null = sin gesto en curso).
  const [neighbor, setNeighbor] = useState<{ path: string; dir: 1 | -1 } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<TabDrag | null>(null)
  const settlingRef = useRef(false) // animación de asentado en curso
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const sessionRef = useRef(Boolean(session))
  sessionRef.current = Boolean(session)

  // Gestos con listeners NATIVOS (React registra touchmove como passive y no
  // deja preventDefault). Transformamos el DOM directo (sin estado por frame):
  // un re-render por movimiento mataría los 60fps (lección del pull-to-refresh).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const setTransforms = (off: number, settle: boolean) => {
      const d = dragRef.current
      const c = contentRef.current
      const o = overlayRef.current
      if (!d) return
      const t = settle ? 'transform 0.36s cubic-bezier(0.32, 0.72, 0, 1)' : 'none'
      if (c) {
        c.style.transition = t
        c.style.transform = `translateX(${off}px)`
      }
      if (o) {
        o.style.transition = t
        o.style.transform = `translateX(${off + d.dir * d.width}px)`
      }
    }

    const cleanupDrag = () => {
      setNeighbor(null)
      delete (window as unknown as Record<string, unknown>).__dealrPreview
      const c = contentRef.current
      if (c) {
        c.style.transition = ''
        c.style.transform = ''
      }
      settlingRef.current = false
    }

    const onStart = (e: TouchEvent) => {
      if (settlingRef.current || e.touches.length !== 1) return
      if (!TAB_ORDER.includes(pathRef.current)) return
      const t = e.target as HTMLElement
      // No arrancar donde el gesto horizontal ya significa otra cosa:
      // scrolls horizontales (categorías/rieles), mapas, inputs y overlays.
      if (t.closest('.overflow-x-auto, .leaflet-container, input, textarea, select, .fixed')) return
      const x = e.touches[0].clientX
      // Los bordes son del sistema (atrás/adelante de iOS): no competimos.
      if (x < 24 || x > window.innerWidth - 24) return
      dragRef.current = {
        startX: x,
        startY: e.touches[0].clientY,
        active: false,
        blocked: false,
        dir: 1,
        off: 0,
        lastX: x,
        lastT: e.timeStamp,
        vx: 0,
        width: el.clientWidth || window.innerWidth,
      }
    }

    const onMove = (e: TouchEvent) => {
      const d = dragRef.current
      if (!d || d.blocked) return
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - d.startX
      const dy = y - d.startY
      if (!d.active) {
        // Decidir el eje UNA vez: vertical franco → scroll normal, no tocamos.
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          d.blocked = true
          return
        }
        if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          const idx = TAB_ORDER.indexOf(pathRef.current)
          const dir: 1 | -1 = dx < 0 ? 1 : -1
          const targetIdx = idx + dir
          if (idx === -1 || targetIdx < 0 || targetIdx >= TAB_ORDER.length) {
            d.blocked = true // no hay vecino hacia ese lado
            return
          }
          // Sin sesión, Chats/Perfil redirigen a /auth: montarlas de preview
          // dispararía ese redirect EN PLENO gesto. El swipe no las ofrece
          // (el tap sí, que es una acción deliberada).
          const target = TAB_ORDER[targetIdx]
          if (!sessionRef.current && (target === '/chats' || target === '/perfil')) {
            d.blocked = true
            return
          }
          d.active = true
          d.dir = dir
          // El vecino se monta "de preview": Home no debe restaurar el scroll
          // del feed (movería la ventana en pleno arrastre).
          ;(window as unknown as Record<string, unknown>).__dealrPreview = true
          setNeighbor({ path: TAB_ORDER[targetIdx], dir })
          haptic('tick')
        } else {
          return
        }
      }
      e.preventDefault() // ya es nuestro: congela el scroll vertical
      const inst = (x - d.lastX) / Math.max(1, e.timeStamp - d.lastT)
      d.vx = d.vx * 0.8 + inst * 0.2
      d.lastX = x
      d.lastT = e.timeStamp
      // Solo hacia el vecino; hacia el otro lado, resistencia elástica.
      d.off = d.dir === 1 ? Math.min(dx, 0) : Math.max(dx, 0)
      if (d.off === 0 && dx !== 0) d.off = dx * 0.2
      setTransforms(d.off, false)
    }

    const onEnd = () => {
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (!d.active) return
      settlingRef.current = true
      const fast = Math.abs(d.off) > 50 && (d.dir === 1 ? d.vx < -0.45 : d.vx > 0.45)
      const commit = (Math.abs(d.off) > d.width * 0.3 || fast) && Math.sign(d.off) === -d.dir
      if (commit) {
        dragRef.current = d // setTransforms lo necesita
        setTransforms(-d.dir * d.width, true)
        dragRef.current = null
        window.setTimeout(() => {
          const target = TAB_ORDER[TAB_ORDER.indexOf(pathRef.current) + d.dir]
          if (!target) return cleanupDrag()
          if (target === '/') resetFeedScroll() // llegar por swipe = feed arriba
          navigateRef.current(target, { replace: true, state: { tabDir: 'silent' } })
          window.scrollTo(0, 0)
          haptic('tap')
          // El overlay tapa el remount un instante (evita el parpadeo de carga).
          window.setTimeout(cleanupDrag, 310)
        }, 360)
      } else {
        dragRef.current = d
        setTransforms(0, true)
        dragRef.current = null
        window.setTimeout(cleanupDrag, 380)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

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
  // Si la navegación trae dirección explícita (tap en la barra inferior, que
  // pasa tabDir según la posición relativa de la pestaña), manda esa — pero
  // NUNCA en un POP del historial: ahí el state es el guardado de la visita
  // anterior y usarlo animaría para el lado equivocado.
  // 'silent' = llegada por swipe interactivo: la transición ya ocurrió con el
  // dedo, el remount no debe animar nada.
  const tabDir = navType !== 'POP' ? (location.state as { tabDir?: 'push' | 'pop' | 'silent' } | null)?.tabDir : undefined
  const pageAnim =
    tabDir === 'silent' ? '' : (tabDir ?? (navType === 'POP' ? 'pop' : 'push')) === 'pop' ? 'page-pop' : 'page-push'
  // En DESKTOP (lg+) solo el feed se ensancha para respirar; el resto queda en la
  // columna angosta de siempre. Mobile no cambia (las clases base son idénticas).
  const isFeed = location.pathname === '/'
  const NeighborPage = neighbor ? TAB_COMPONENTS[neighbor.path] : null
  return (
    <div ref={wrapRef} className={`mx-auto min-h-dvh overflow-x-hidden bg-black max-w-lg ${isFeed ? 'lg:max-w-4xl' : ''}`}>
      <Suspense fallback={<div className="min-h-dvh bg-black" />}>
        <div key={location.pathname} ref={contentRef} className={pageAnim}>
          <Outlet />
        </div>
      </Suspense>
      {/* Página vecina durante el swipe: pantalla completa, arranca fuera de
          cámara del lado correspondiente y sigue al dedo (transform directo al
          DOM desde el handler). z-20 < BottomNav (z-30): la barra queda fija. */}
      {NeighborPage && neighbor && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-20 overflow-hidden bg-black"
          style={{ transform: `translateX(${neighbor.dir * 100}%)` }}
        >
          <div className={`mx-auto h-full max-w-lg overflow-hidden bg-black ${neighbor.path === '/' ? 'lg:max-w-4xl' : ''}`}>
            <NeighborPage />
          </div>
        </div>
      )}
      {!hideNav && <BottomNav />}
      {showIntro && <IntroSlides onDone={() => setShowIntro(false)} />}
      <CotillonListener />
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
    // Visita anónima del día (funnel del panel de admin)
    trackVisit()
  }, [])
  if (!supabaseConfigured || supabaseUrlInvalid) return <SetupNotice />
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
        <FavoritesProvider>
        <NotificationsProvider>
        <UnreadChatsProvider>
        {/* OJO: NO usar future.v7_startTransition — envuelve cada navegación en
            startTransition y los setState concurrentes (realtime, fetches, el
            tick de las cards) interrumpen y reinician ese render: la página
            nueva tardaba ~2s en montar (medido) y la animación no se veía.
            Las pestañas son eager y el resto se precarga: mount sincrónico. */}
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
