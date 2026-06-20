import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Category } from '../lib/types'
import { openFeed } from './Home'

// Por categoría: emoji (fallback) + keyword para la foto temática.
// Las fotos salen de loremflickr (gratis, sin key). Para producción se pueden
// reemplazar por imágenes curadas en /public/categories/<slug>.jpg cambiando
// imageFor().
const CATS: Record<string, { emoji: string; kw: string }> = {
  celulares: { emoji: '📱', kw: 'smartphone' },
  computacion: { emoji: '💻', kw: 'laptop' },
  electronica: { emoji: '🎧', kw: 'headphones' },
  'consolas-videojuegos': { emoji: '🎮', kw: 'gaming' },
  'hogar-muebles': { emoji: '🛋️', kw: 'furniture' },
  electrodomesticos: { emoji: '🧺', kw: 'appliance' },
  'ropa-accesorios': { emoji: '👕', kw: 'clothes' },
  'deportes-fitness': { emoji: '🏋️', kw: 'fitness' },
  bicicletas: { emoji: '🚲', kw: 'bicycle' },
  'vehiculos-accesorios': { emoji: '🚗', kw: 'car' },
  'bebes-ninos': { emoji: '🧸', kw: 'baby' },
  herramientas: { emoji: '🔧', kw: 'tools' },
  instrumentos: { emoji: '🎸', kw: 'guitar' },
  'libros-musica': { emoji: '📚', kw: 'books' },
  'plantas-jardineria': { emoji: '🪴', kw: 'plants' },
  otros: { emoji: '📦', kw: 'boxes' },
}

function imageFor(slug: string, id: number): string {
  const kw = CATS[slug]?.kw ?? 'product'
  // lock fija la imagen para que no cambie en cada carga.
  return `https://loremflickr.com/320/240/${kw}?lock=${id}`
}

function CategoryTile({ category, onOpen }: { category: Category; onOpen: (c: Category) => void }) {
  // 0 = imagen local (/public/categories/<slug>.jpg), 1 = foto remota, 2 = emoji
  const [step, setStep] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const meta = CATS[category.slug]
  const src = step === 0 ? `/categories/${category.slug}.jpg` : imageFor(category.slug, category.id)
  return (
    <button
      onClick={() => onOpen(category)}
      className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-800 transition active:opacity-80"
    >
      {step < 2 ? (
        <>
          {!loaded && <div className="img-shimmer pointer-events-none absolute inset-0" />}
          <img
            src={src}
            alt=""
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false)
              setStep((s) => s + 1)
            }}
            className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-4xl">{meta?.emoji ?? '🏷️'}</span>
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 px-3 pb-2.5 text-left text-sm font-semibold leading-tight text-white">
        {category.name}
      </span>
    </button>
  )
}

export default function Explorar() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => setCategories((data ?? []).filter((c: Category) => !c.parent_id)))
  }, [])

  function open(category: Category) {
    openFeed({ categoryId: category.id })
    navigate('/')
  }

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Explorar</h1>
        <p className="mt-0.5 text-sm text-neutral-500">Mirá por categoría</p>
      </header>

      <div className="grid grid-cols-2 gap-2.5 px-5">
        {categories.map((c) => (
          <CategoryTile key={c.id} category={c} onOpen={open} />
        ))}
      </div>
    </div>
  )
}
