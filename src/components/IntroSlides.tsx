import { useRef, useState } from 'react'
import { markIntroSeen } from '../lib/intro'

interface Slide {
  title: string
  body: string
  // Foto de fondo (poné los archivos en public/onboarding/). Si falta, se ve
  // el degradado de color de `fallback` y queda prolijo igual.
  image: string
  fallback: string
}

const SLIDES: Slide[] = [
  {
    title: 'Un marketplace seguro',
    body: 'Con gente verificada. Validamos identidades para que compres y vendas con más confianza.',
    image: '/onboarding/Comprasegura.jpg',
    fallback: 'from-emerald-900 via-neutral-950 to-black',
  },
  {
    title: 'Comprá y vendé a tu manera',
    body: 'Con subastas, ofertas o mensajes directos con el dueño. El trato se cierra como vos quieras.',
    image: '/onboarding/Subasta.jpg',
    fallback: 'from-amber-900 via-neutral-950 to-black',
  },
  {
    title: 'Descubrí cerca tuyo',
    body: 'Fijate qué hay de interesante cerca tuyo con el mapa.',
    image: '/onboarding/CompraMapa.jpg',
    fallback: 'from-sky-900 via-neutral-950 to-black',
  },
]

// Rutas de las fotos del onboarding, para precargarlas (ej. desde Auth) y que
// se vean al instante cuando aparecen los slides tras iniciar sesión.
export const ONBOARDING_IMAGES = SLIDES.map((s) => s.image)

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function IntroSlides({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  // Arrastre: la pista sigue al dedo (dragX en px) y al soltar hace snap.
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const width = useRef(0)
  const last = i === SLIDES.length - 1

  function finish() {
    markIntroSeen()
    onDone()
  }

  function go(n: number) {
    setI(Math.max(0, Math.min(SLIDES.length - 1, n)))
  }

  function onDown(e: React.PointerEvent) {
    startX.current = e.clientX
    width.current = e.currentTarget.clientWidth || window.innerWidth
    setDragging(true)
  }
  function onMove(e: React.PointerEvent) {
    if (!dragging) return
    let dx = e.clientX - startX.current
    // Resistencia (rubber-band) en los extremos: no hay slide más allá.
    if ((i === 0 && dx > 0) || (last && dx < 0)) dx *= 0.3
    setDragX(dx)
  }
  function onUp() {
    if (!dragging) return
    setDragging(false)
    const threshold = Math.max(60, width.current * 0.2)
    if (dragX <= -threshold) go(i + 1)
    else if (dragX >= threshold) go(i - 1)
    setDragX(0)
  }

  return (
    <div
      className="fixed inset-0 z-[680] overflow-hidden bg-black"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      {/* Pista deslizable: las 3 pantallas en fila; se mueve con el dedo y, al
          soltar, transiciona al slide elegido (misma curva que las pantallas). */}
      <div
        className="flex h-full w-full"
        style={{
          transform: `translateX(calc(${-i * 100}% + ${dragX}px))`,
          transition: dragging || reducedMotion ? 'none' : 'transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {SLIDES.map((slide, n) => (
          <div key={n} className="relative h-full w-full shrink-0">
            <div className={`absolute inset-0 bg-gradient-to-b ${slide.fallback}`} />
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${slide.image})` }} />
            {/* Oscurecido para que el texto se lea */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/25" />
            <div className="absolute inset-x-0 bottom-0 select-none px-8 pb-44">
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">{slide.title}</h2>
              <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/80">{slide.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Controles fijos por encima de la pista. pointer-events-none deja que el
          arrastre pase a la pista; solo los botones reciben toque. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="flex justify-end">
          <button onClick={finish} className="pointer-events-auto text-sm font-medium text-white/70">
            Saltar
          </button>
        </div>

        <div className="flex-1" />

        <div className="space-y-6">
          <div className="flex gap-2">
            {SLIDES.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-white' : 'w-1.5 bg-white/40'}`}
              />
            ))}
          </div>
          <button
            onClick={() => (last ? finish() : go(i + 1))}
            className="pointer-events-auto w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black transition active:scale-[0.98]"
          >
            {last ? 'Empezar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}
