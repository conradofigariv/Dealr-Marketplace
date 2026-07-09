import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Category } from '../lib/types'
import { openFeed } from './Home'

// Por categoría: foto curada en /public/categories/<slug>.jpg; si falta, cae
// al emoji (prolijo y consistente). Antes había un fallback intermedio a
// loremflickr (fotos de stock ALEATORIAS de un tercero) que se veía a
// placeholder de desarrollo — fuera para el lanzamiento.
const CATS: Record<string, { emoji: string }> = {
  celulares: { emoji: '📱' },
  computacion: { emoji: '💻' },
  electronica: { emoji: '🎧' },
  'consolas-videojuegos': { emoji: '🎮' },
  'hogar-muebles': { emoji: '🛋️' },
  electrodomesticos: { emoji: '🧺' },
  'ropa-accesorios': { emoji: '👕' },
  'deportes-fitness': { emoji: '🏋️' },
  bicicletas: { emoji: '🚲' },
  'vehiculos-accesorios': { emoji: '🚗' },
  'bebes-ninos': { emoji: '🧸' },
  herramientas: { emoji: '🔧' },
  instrumentos: { emoji: '🎸' },
  'libros-musica': { emoji: '📚' },
  'plantas-jardineria': { emoji: '🪴' },
  alquileres: { emoji: '🏠' },
  otros: { emoji: '📦' },
}

function CategoryTile({ category, onOpen }: { category: Category; onOpen: (c: Category) => void }) {
  // true = imagen local (/public/categories/<slug>.jpg); false = emoji
  const [useImage, setUseImage] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const meta = CATS[category.slug]
  const src = `/categories/${category.slug}.jpg`
  return (
    <button
      onClick={() => onOpen(category)}
      className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-800 transition active:opacity-80"
    >
      {useImage ? (
        <>
          {!loaded && <div className="img-shimmer pointer-events-none absolute inset-0" />}
          <img
            src={src}
            alt=""
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false)
              setUseImage(false)
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
