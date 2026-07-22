import { NavLink, useLocation } from 'react-router-dom'
import { useUnreadChats } from '../hooks/useUnreadChats'
import { haptic } from '../lib/notify'

const tabs = [
  {
    to: '/',
    label: 'Inicio',
    icon: (
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z" />
    ),
  },
  {
    to: '/explorar',
    label: 'Explorar',
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  {
    to: '/publicar',
    label: 'Vender',
    icon: <path d="M12 5v14M5 12h14" strokeWidth="2.2" />,
  },
  {
    to: '/chats',
    label: 'Chats',
    icon: (
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />
    ),
  },
  {
    to: '/perfil',
    label: 'Perfil',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
      </>
    ),
  },
]

// Nav flotante tipo píldora, solo íconos (estilo Savee)
export default function BottomNav() {
  const { count } = useUnreadChats()
  const location = useLocation()
  // Dirección de la transición: ir a una pestaña a la DERECHA de la actual
  // entra desde la derecha (push) y viceversa — la animación acompaña el lado
  // hacia el que te movés en la barra (el Shell lee `tabDir` del state).
  const currentIdx = tabs.findIndex((t) => t.to === location.pathname)
  return (
    // [transform:translateZ(0)]: fuerza una capa de GPU propia para esta barra
    // fixed. Sin esto, en iOS el backdrop-blur de abajo obliga a Safari a
    // repintarla en cada frame de scroll; con el feed cargado de fotos, el
    // hilo principal se atrasa y el compositor "pierde" la barra — se ve
    // scrolleando con el contenido hasta que el scroll frena. Promoverla a su
    // propia capa la desacopla del hilo principal (no pisa -translate-x-1/2:
    // en Tailwind v4 los `translate-*` usan la propiedad `translate`, no
    // `transform`).
    <nav className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 [transform:translateZ(0)] [will-change:transform]">
      <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 px-3 py-2 ring-1 ring-white/10 backdrop-blur-md">
        {tabs.map((tab, idx) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            aria-label={tab.label}
            // replace: cambiar de pestaña NO apila historial (como una app
            // nativa). Sin esto, el gesto de borde de iOS (atrás/adelante)
            // recorría todos los taps de pestañas previos y parecía que el
            // swipe entre secciones seguía existiendo.
            replace={currentIdx !== -1}
            state={currentIdx !== -1 ? { tabDir: idx > currentIdx ? 'push' : 'pop' } : undefined}
            onClick={() => haptic('tap')}
            className={({ isActive }) =>
              // "Vender" es EL llamado a la acción del negocio: píldora ámbar
              // brillante con etiqueta, sobresale del resto de la barra.
              tab.to === '/publicar'
                ? 'relative mx-0.5 flex items-center gap-1 rounded-full bg-gradient-to-b from-amber-400 to-amber-500 py-2.5 pl-2.5 pr-3.5 text-black shadow-[0_0_18px_rgba(245,158,11,0.45)] ring-1 ring-amber-300/60 transition active:scale-95'
                : `relative rounded-full p-2.5 transition ${isActive ? 'text-white' : 'text-neutral-500'}`
            }
          >
            <svg
              viewBox="0 0 24 24"
              className={tab.to === '/publicar' ? 'h-5 w-5' : 'h-6 w-6'}
              fill="none"
              stroke="currentColor"
              strokeWidth={tab.to === '/publicar' ? 2.6 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {tab.icon}
            </svg>
            {tab.to === '/publicar' && <span className="text-sm font-bold">Vender</span>}
            {tab.to === '/chats' && count > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-neutral-900">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
