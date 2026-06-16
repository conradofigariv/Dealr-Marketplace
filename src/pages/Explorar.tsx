import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Category } from '../lib/types'
import { openFeed } from './Home'

// Ícono por categoría (emoji: simple, con color, sin librerías). Las que no
// estén mapeadas caen en el genérico.
const ICONS: Record<string, string> = {
  celulares: '📱',
  computacion: '💻',
  electronica: '🎧',
  'consolas-videojuegos': '🎮',
  'hogar-muebles': '🛋️',
  electrodomesticos: '🧺',
  'ropa-accesorios': '👕',
  'deportes-fitness': '🏋️',
  bicicletas: '🚲',
  'vehiculos-accesorios': '🚗',
  'bebes-ninos': '🧸',
  herramientas: '🔧',
  instrumentos: '🎸',
  'libros-musica': '📚',
  otros: '📦',
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

      <div className="grid grid-cols-2 gap-3 px-5">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => open(c)}
            className="flex items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-4 text-left ring-1 ring-neutral-800 transition active:bg-neutral-800"
          >
            <span className="text-2xl">{ICONS[c.slug] ?? '🏷️'}</span>
            <span className="text-sm font-semibold leading-tight text-white">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
