import { useState, type ReactElement } from 'react'
import { markIntroSeen } from '../lib/intro'

interface Slide {
  icon: ReactElement
  title: string
  body: string
}

// 3 slides máximo: las funciones que más enganchan al abrir por primera vez.
const SLIDES: Slide[] = [
  {
    icon: (
      <>
        <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    title: 'Usados cerca tuyo',
    body: 'Miles de cosas en Córdoba. Buscalas en el feed o en el mapa, filtrá por precio, zona y categoría.',
  },
  {
    icon: (
      <>
        <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />
      </>
    ),
    title: 'Hablá y cerrá el trato',
    body: 'Chateás directo con el vendedor, hacés ofertas o participás de subastas en vivo. El trato se cierra como vos quieras.',
  },
  {
    icon: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    title: 'No te pierdas nada',
    body: 'Guardá favoritos, seguí bajadas de precio y recibí avisos al instante, incluso con la app cerrada.',
  },
]

export default function IntroSlides({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const last = i === SLIDES.length - 1

  function finish() {
    markIntroSeen()
    onDone()
  }

  const slide = SLIDES[i]

  return (
    <div className="fixed inset-0 z-[680] flex flex-col bg-black px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex justify-end">
        <button onClick={finish} className="text-sm font-medium text-neutral-500">
          Saltar
        </button>
      </div>

      <div key={i} className="sheet-in flex flex-1 flex-col items-center justify-center text-center">
        <span className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-neutral-900 text-white ring-1 ring-neutral-800">
          <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {slide.icon}
          </svg>
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-white">{slide.title}</h2>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-neutral-400">{slide.body}</p>
      </div>

      <div className="space-y-6">
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, n) => (
            <span
              key={n}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-white' : 'w-1.5 bg-neutral-700'}`}
            />
          ))}
        </div>
        <button
          onClick={() => (last ? finish() : setI((n) => n + 1))}
          className="btn-primary w-full py-3.5 text-sm"
        >
          {last ? 'Empezar' : 'Siguiente'}
        </button>
      </div>
    </div>
  )
}
