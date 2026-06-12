import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { supabaseConfigured } from './lib/supabase'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Auth from './pages/Auth'
import ListingDetail from './pages/ListingDetail'
import Publish from './pages/Publish'
import Chats from './pages/Chats'
import ChatThread from './pages/ChatThread'
import Profile from './pages/Profile'

function Shell() {
  const location = useLocation()
  // El hilo de chat y el detalle manejan sus propias acciones a pantalla completa
  const hideNav = /^\/(chats|p)\/.+/.test(location.pathname)
  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-black">
      <Outlet />
      {!hideNav && <BottomNav />}
    </div>
  )
}

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-10 text-center">
      <h1 className="text-5xl font-bold tracking-tight text-white">Dealr</h1>
      <p className="text-sm text-neutral-400">
        Faltan las variables de entorno de Supabase. Configurá{' '}
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">VITE_SUPABASE_URL</code> y{' '}
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">VITE_SUPABASE_ANON_KEY</code>{' '}
        (ver <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-200">.env.example</code>) y recargá.
      </p>
    </div>
  )
}

export default function App() {
  if (!supabaseConfigured) return <SetupNotice />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
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
