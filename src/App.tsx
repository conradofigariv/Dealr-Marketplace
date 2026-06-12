import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { supabaseConfigured, supabaseUrlInvalid, supabaseUrlConfigured } from './lib/supabase'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'

// Code-splitting: el feed carga al instante, el resto bajo demanda
const Auth = lazy(() => import('./pages/Auth'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const ListingDetail = lazy(() => import('./pages/ListingDetail'))
const Publish = lazy(() => import('./pages/Publish'))
const Chats = lazy(() => import('./pages/Chats'))
const ChatThread = lazy(() => import('./pages/ChatThread'))
const Profile = lazy(() => import('./pages/Profile'))

function Shell() {
  const location = useLocation()
  const { profile } = useAuth()
  // Recién registrado con username autogenerado: primero elige su nombre
  if (profile && /^usuario_[0-9a-f]{8}$/.test(profile.username)) {
    return <Navigate to="/onboarding" replace />
  }
  // El hilo de chat y el detalle manejan sus propias acciones a pantalla completa
  const hideNav = /^\/(chats|p)\/.+/.test(location.pathname)
  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-black">
      <Suspense fallback={<div className="min-h-dvh bg-black" />}>
        <Outlet />
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
  if (!supabaseConfigured || supabaseUrlInvalid) return <SetupNotice />
  return (
    <AuthProvider>
      <BrowserRouter>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
