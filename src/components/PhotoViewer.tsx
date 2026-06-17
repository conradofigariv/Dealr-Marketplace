import { useEffect, useRef, useState } from 'react'
import { photoUrl } from '../lib/supabase'

// Visor de fotos a pantalla completa: swipe horizontal entre fotos (snap) y
// zoom con doble tap. Estilo galería de Marketplace.
export default function PhotoViewer({
  photos,
  index = 0,
  onClose,
}: {
  photos: string[]
  index?: number
  onClose: () => void
}) {
  const [zoomed, setZoomed] = useState<number | null>(null)
  const [current, setCurrent] = useState(index)
  const lastTap = useRef(0)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Posicionar en la foto tocada al abrir + bloquear el scroll del fondo.
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollLeft = index * el.clientWidth
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [index])

  function onTap(i: number) {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      setZoomed((z) => (z === i ? null : i))
    }
    lastTap.current = now
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <button
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      {photos.length > 1 && (
        <span className="absolute left-1/2 top-[max(0.85rem,env(safe-area-inset-top))] z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {current + 1}/{photos.length}
        </span>
      )}

      <div
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setCurrent(Math.round(el.scrollLeft / el.clientWidth))
        }}
        className={`no-scrollbar flex h-full ${zoomed === null ? 'snap-x snap-mandatory overflow-x-auto' : 'overflow-hidden'}`}
      >
        {photos.map((p, i) => (
          <div key={i} className="flex h-full w-full shrink-0 snap-center items-center justify-center overflow-hidden">
            <img
              src={photoUrl(p)}
              alt={`Foto ${i + 1}`}
              onClick={() => onTap(i)}
              className={`max-h-full max-w-full object-contain transition-transform duration-300 ${
                zoomed === i ? 'scale-[2.2]' : 'scale-100'
              }`}
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && (
        <p className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-white/60">
          Deslizá para ver más · doble tap para zoom
        </p>
      )}
    </div>
  )
}
