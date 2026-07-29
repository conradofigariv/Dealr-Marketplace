import { Link } from 'react-router-dom'
import Logo from './Logo'

// Header para las pantallas donde alguien puede ATERRIZAR desde afuera (link
// compartido, publicidad) y no tendría ninguna navegación: sin esto el
// visitante queda encerrado en el detalle, que oculta la BottomNav porque
// abajo van los botones de conversión.
//
// Solo marca + una salida al feed: guardados y notificaciones no le sirven a
// quien todavía no es usuario, y el selector de ubicación vive en Home (acá,
// de solo lectura, solo confundía).
export default function AppHeader() {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <Link to="/" aria-label="Ir a Dealr" className="shrink-0">
        <Logo size={32} />
      </Link>
      <Link
        to="/"
        className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-4 py-2 text-sm font-bold text-amber-400 ring-1 ring-amber-500/30 transition active:scale-95"
      >
        Ver más productos
      </Link>
    </header>
  )
}
