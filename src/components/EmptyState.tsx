import type { ReactNode } from 'react'

// Estado vacío con ícono: para pantallas sin contenido (guardados, chats,
// notificaciones, búsquedas). Más intencional que un texto pelado.
export default function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-8 py-24 text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-900 text-neutral-600 ring-1 ring-neutral-800">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <p className="text-sm text-neutral-400">{title}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}
