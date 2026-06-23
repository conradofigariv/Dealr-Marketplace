import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import ActionMenu, { type MenuAction } from './ActionMenu'
import { vibrate } from '../lib/notify'

// Envuelve cualquier contenido y, con long-press (o click derecho en desktop),
// abre un ActionMenu estilo iOS con acciones —igual que los mensajes del chat.
// Si no hay acciones (ej. usuario no admin), no intercepta nada: renderiza el
// contenido tal cual. Pensado para las acciones de moderación del admin.
export default function LongPressActions({
  actions,
  children,
  className,
}: {
  actions: MenuAction[]
  children: ReactNode
  className?: string
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pressing, setPressing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const moved = useRef(false)
  // Tras abrir el menú con long-press, frenamos el click que viene después
  // (si no, un Link navegaría al soltar el dedo).
  const justOpened = useRef(false)

  if (actions.length === 0) return <>{children}</>

  function openAt(el: HTMLElement) {
    justOpened.current = true
    setRect(el.getBoundingClientRect())
    setTimeout(() => (justOpened.current = false), 400)
  }

  function start(e: PointerEvent<HTMLDivElement>) {
    moved.current = false
    setPressing(true)
    const el = e.currentTarget
    timer.current = setTimeout(() => {
      setPressing(false)
      if (!moved.current) {
        vibrate(12)
        openAt(el)
      }
    }, 450)
  }

  function cancel() {
    clearTimeout(timer.current)
    setPressing(false)
  }

  function move() {
    moved.current = true
    setPressing(false)
  }

  return (
    <>
      <div
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerMove={move}
        onClickCapture={(e) => {
          if (justOpened.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          openAt(e.currentTarget)
        }}
        className={`${className ?? ''} ${pressing ? 'msg-pressing' : ''}`}
      >
        {children}
      </div>
      {rect && (
        <ActionMenu
          rect={rect}
          actions={actions.map((a) => ({
            ...a,
            onClick: () => {
              a.onClick()
              setRect(null)
            },
          }))}
          onClose={() => setRect(null)}
          anchor={<div className="pointer-events-none h-full w-full">{children}</div>}
        />
      )}
    </>
  )
}
