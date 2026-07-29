import { Link } from 'react-router-dom'
import Logo from './Logo'
import { useNotifications } from '../hooks/useNotifications'
import { getCachedBuyerLabel } from '../lib/geo'

// Header de la app (logo + guardados + notificaciones + ubicación), pensado
// para las pantallas donde alguien puede ATERRIZAR desde afuera (link
// compartido, publicidad) y no tendría ninguna navegación: sin esto el
// visitante queda encerrado en el detalle, que oculta la BottomNav porque
// abajo van los botones de conversión.
//
// La ubicación acá es de solo lectura (muestra la cacheada y lleva al feed);
// el selector interactivo —geolocalización, mapa— vive en Home.
export default function AppHeader() {
  const { unreadCount } = useNotifications()
  const label = getCachedBuyerLabel()

  return (
    <header className="px-4 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
      {/* Logo centrado (absoluto) con los íconos de acción a la derecha. */}
      <div className="relative flex h-11 items-center justify-end">
        <Link to="/" aria-label="Ir a Dealr" className="absolute left-1/2 -translate-x-1/2">
          <Logo size={32} />
        </Link>
        <div className="flex items-center">
          <Link to="/guardados" aria-label="Guardados" className="p-2.5 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
            </svg>
          </Link>
          <Link to="/notificaciones" aria-label="Notificaciones" className="relative p-2 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </div>
      <Link
        to="/"
        className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[15px] font-medium text-neutral-400 transition active:scale-95 active:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="truncate">{label ?? 'Definí tu zona'}</span>
      </Link>
    </header>
  )
}
