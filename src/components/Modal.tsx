import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      {/* max-h + flex-col: el header queda FIJO arriba (X siempre alcanzable) y el
          contenido scrollea adentro. Sin esto, un sheet largo (ej. filtros de
          Inmuebles) crecía más que la pantalla y la X quedaba fuera de vista. */}
      <div
        className="sheet-in flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[#141414] ring-1 ring-neutral-800 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-6">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-full p-1 text-neutral-500 transition hover:text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
