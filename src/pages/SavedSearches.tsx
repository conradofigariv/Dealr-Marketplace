import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAuthGate } from '../hooks/useAuthGate'
import { conditionLabels, formatPrice } from '../lib/format'
import type { Category, SavedSearch } from '../lib/types'
import EmptyState from '../components/EmptyState'
import { openFeed } from './Home'

function summarize(s: SavedSearch, categoryName?: string): string {
  const parts: string[] = []
  if (s.query) parts.push(`"${s.query}"`)
  if (categoryName) parts.push(categoryName)
  if (s.min_price != null && s.max_price != null) {
    parts.push(`${formatPrice(s.min_price, s.currency ?? 'ARS')}–${formatPrice(s.max_price, s.currency ?? 'ARS')}`)
  } else if (s.min_price != null) {
    parts.push(`desde ${formatPrice(s.min_price, s.currency ?? 'ARS')}`)
  } else if (s.max_price != null) {
    parts.push(`hasta ${formatPrice(s.max_price, s.currency ?? 'ARS')}`)
  } else if (s.currency) {
    parts.push(s.currency)
  }
  if (s.conditions?.length) parts.push(s.conditions.map((c) => conditionLabels[c]).join(', '))
  // Filtros finos guardados (campos, rangos, amenities): resumen por cantidad.
  const fineCount =
    Object.keys(s.fields ?? {}).length + Object.keys(s.field_ranges ?? {}).length + Object.keys(s.multi ?? {}).length
  if (fineCount > 0) parts.push(`+${fineCount} ${fineCount === 1 ? 'filtro' : 'filtros'}`)
  return parts.join(' · ') || 'Todas las publicaciones'
}

export default function SavedSearches() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [categories, setCategories] = useState<Record<number, string>>({})
  const [fetched, setFetched] = useState(false)

  // Guardia tolerante al resume de la PWA (ver useAuthGate).
  useAuthGate('/busquedas')

  useEffect(() => {
    if (!session) return
    supabase
      .from('saved_searches')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSearches((data as SavedSearch[]) ?? [])
        setFetched(true)
      })
    supabase
      .from('categories')
      .select('id, name')
      .then(({ data }) => {
        const map: Record<number, string> = {}
        ;(data as Pick<Category, 'id' | 'name'>[] | null)?.forEach((c) => (map[c.id] = c.name))
        setCategories(map)
      })
  }, [session])

  function apply(s: SavedSearch) {
    openFeed({
      search: s.query ?? '',
      categoryId: s.category_id,
      filters: {
        priceMin: s.min_price != null ? String(s.min_price) : '',
        priceMax: s.max_price != null ? String(s.max_price) : '',
        currency: s.currency ?? 'all',
        conditions: s.conditions ?? [],
        radiusKm: null,
        // Filtros finos guardados (00043); null en búsquedas viejas.
        fields: s.fields ?? {},
        fieldRanges: s.field_ranges ?? {},
        multi: s.multi ?? {},
      },
    })
    navigate('/')
  }

  async function remove(id: string) {
    setSearches((prev) => prev.filter((s) => s.id !== id))
    await supabase.from('saved_searches').delete().eq('id', id)
  }

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Búsquedas guardadas</h1>
        <p className="mt-0.5 text-sm text-neutral-500">Te avisamos cuando se publique algo que matchee.</p>
      </header>

      {fetched && searches.length === 0 ? (
        <EmptyState
          icon={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>}
          title="Todavía no guardaste ninguna búsqueda."
        >
          <Link to="/" className="font-semibold text-white">Buscar productos</Link>
        </EmptyState>
      ) : (
        <ul className="space-y-2 px-5">
          {searches.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800"
            >
              <button onClick={() => apply(s)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                  {summarize(s, s.category_id != null ? categories[s.category_id] : undefined)}
                </span>
              </button>
              <button
                onClick={() => remove(s.id)}
                aria-label="Eliminar búsqueda"
                className="shrink-0 rounded-full p-1.5 text-neutral-500 transition hover:text-red-400"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
