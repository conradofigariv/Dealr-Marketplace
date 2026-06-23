import { useState } from 'react'
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
    image: '/onboarding/1.jpg',
    fallback: 'from-emerald-900 via-neutral-950 to-black',
  },
  {
    title: 'Comprá y vendé a tu manera',
    body: 'Con subastas, ofertas o mensajes directos con el dueño. El trato se cierra como vos quieras.',
    image: '/onboarding/2.jpg',
    fallback: 'from-amber-900 via-neutral-950 to-black',
  },
  {
    title: 'Descubrí cerca tuyo',
    body: 'Fijate qué hay de interesante cerca tuyo con el mapa.',
    image: '/onboarding/3.jpg',
    fallback: 'from-sky-900 via-neutral-950 to-black',
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
    <div className="fixed inset-0 z-[680] overflow-hidden bg-black">
      {/* Fondo: degradado de color (fallback) + foto encima si existe */}
      <div key={`bg-${i}`} className="absolute inset-0">
        <div className={`absolute inset-0 bg-gradient-to-b ${slide.fallback}`} />
        <div
          className="sheet-in absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${slide.image})` }}
        />
        {/* Oscurecido para que el texto se lea */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/25" />
      </div>

      {/* Contenido */}
      <div className="relative flex h-full flex-col px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="flex justify-end">
          <button onClick={finish} className="text-sm font-medium text-white/70">
            Saltar
          </button>
        </div>

        <div className="flex-1" />

        <div key={`txt-${i}`} className="sheet-in">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">{slide.title}</h2>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/80">{slide.body}</p>
        </div>

        <div className="mt-8 space-y-6">
          <div className="flex gap-2">
            {SLIDES.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-white' : 'w-1.5 bg-white/40'}`}
              />
            ))}
          </div>
          <button
            onClick={() => (last ? finish() : setI((n) => n + 1))}
            className="w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black transition active:scale-[0.98]"
          >
            {last ? 'Empezar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}
