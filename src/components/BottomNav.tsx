import { NavLink } from 'react-router-dom'

const tabs = [
  {
    to: '/',
    label: 'Inicio',
    icon: (
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z" />
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
  return (
    <nav className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 px-3 py-2 ring-1 ring-white/10 backdrop-blur-md">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-label={tab.label}
            className={({ isActive }) =>
              `rounded-full p-2.5 transition ${isActive ? 'text-white' : 'text-neutral-500'}`
            }
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {tab.icon}
            </svg>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
