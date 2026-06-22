import type { ReactNode } from 'react'

export interface MenuAction {
  label: string
  onClick: () => void
  destructive?: boolean
}

// Menú contextual estilo iOS, anclado a un elemento (su `rect`): difumina todo
// lo demás y abre una lista de acciones pegada al lado, arriba/abajo y
// izquierda/derecha según el espacio disponible. `anchor` es un clon nítido
// de lo que se tocó (se ve por encima del blur, en su posición exacta).
export default function ActionMenu({
  rect,
  actions,
  onClose,
  anchor,
}: {
  rect: DOMRect
  actions: MenuAction[]
  onClose: () => void
  anchor?: ReactNode
}) {
  const rowHeight = 46
  const menuHeight = actions.length * rowHeight + 8
  const menuWidth = 180
  const gap = 8
  const spaceBelow = window.innerHeight - rect.bottom
  const placeAbove = spaceBelow < menuHeight + gap + 24
  const menuTop = placeAbove ? Math.max(8, rect.top - menuHeight - gap) : rect.bottom + gap
  const alignRight = rect.right > window.innerWidth / 2
  const menuLeft = alignRight
    ? Math.max(8, rect.right - menuWidth)
    : Math.min(window.innerWidth - menuWidth - 8, rect.left)

  return (
    <div className="fixed inset-0 z-[600]" onClick={onClose}>
      <div className="overlay-in absolute inset-0 bg-black/55 backdrop-blur-md" />
      {anchor && (
        <div
          className="ctx-pop-in absolute select-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            WebkitTouchCallout: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {anchor}
        </div>
      )}
      <div
        className="ctx-pop-in absolute overflow-hidden rounded-2xl bg-neutral-800/95 shadow-xl ring-1 ring-white/10"
        style={{ top: menuTop, left: menuLeft, width: menuWidth, animationDelay: anchor ? '0.03s' : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.map((action, i) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className={`block w-full px-4 py-3 text-left text-[15px] font-medium transition active:bg-white/10 ${
              action.destructive ? 'text-red-400' : 'text-white'
            } ${i > 0 ? 'border-t border-white/10' : ''}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
