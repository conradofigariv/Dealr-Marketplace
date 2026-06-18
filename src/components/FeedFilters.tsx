import { useState } from 'react'
import Modal from './Modal'
import { conditionLabels } from '../lib/format'
import type { FieldDef, ListingCondition } from '../lib/types'

export interface FeedFilterValues {
  priceMin: string
  priceMax: string
  currency: 'all' | 'ARS' | 'USD'
  conditions: ListingCondition[]
  radiusKm: number | null
  // Filtros por campo de categoría (select/boolean). key -> valor elegido
  // ('true' para boolean, la opción para select). Vacío = sin filtro.
  fields: Record<string, string>
}

export const EMPTY_FILTERS: FeedFilterValues = {
  priceMin: '',
  priceMax: '',
  currency: 'all',
  conditions: [],
  radiusKm: null,
  fields: {},
}

export function countActiveFilters(f: FeedFilterValues): number {
  return (
    (f.priceMin ? 1 : 0) +
    (f.priceMax ? 1 : 0) +
    (f.currency !== 'all' ? 1 : 0) +
    (f.conditions.length ? 1 : 0) +
    (f.radiusKm ? 1 : 0) +
    Object.keys(f.fields).length
  )
}

// Solo son buenos filtros los campos de opciones cerradas (no texto libre).
export function filterableFields(fields: FieldDef[] | undefined): FieldDef[] {
  return (fields ?? []).filter((f) => f.type === 'select' || f.type === 'boolean')
}

const RADII = [2, 5, 10, 25] as const

interface Props {
  value: FeedFilterValues
  onApply: (v: FeedFilterValues) => void
  // Garantiza la ubicación del comprador (la pide si hace falta). Devuelve
  // true si quedó disponible. Sin ella no se puede filtrar por distancia.
  ensureLocation: () => Promise<boolean>
  // Campos filtrables de la categoría elegida (select/boolean).
  categoryFields?: FieldDef[]
  onClose: () => void
}

export default function FeedFilters({ value, onApply, ensureLocation, categoryFields, onClose }: Props) {
  const [draft, setDraft] = useState<FeedFilterValues>(value)
  const [locationDenied, setLocationDenied] = useState(false)

  function toggleCondition(c: ListingCondition) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.includes(c) ? d.conditions.filter((x) => x !== c) : [...d.conditions, c],
    }))
  }

  // Setea (o limpia con value=null) un filtro de campo de categoría.
  function setFieldFilter(key: string, value: string | null) {
    setDraft((d) => {
      const fields = { ...d.fields }
      if (value === null) delete fields[key]
      else fields[key] = value
      return { ...d, fields }
    })
  }

  async function pickRadius(km: number | null) {
    if (km === null) return setDraft((d) => ({ ...d, radiusKm: null }))
    const ok = await ensureLocation()
    if (!ok) {
      setLocationDenied(true)
      return
    }
    setLocationDenied(false)
    setDraft((d) => ({ ...d, radiusKm: km }))
  }

  const chip = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
      on ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
    }`

  return (
    <Modal title="Filtros" onClose={onClose}>
      <div className="space-y-6">
        {/* Moneda */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Moneda</p>
          <div className="flex gap-1.5">
            {(['all', 'ARS', 'USD'] as const).map((c) => (
              <button key={c} onClick={() => setDraft((d) => ({ ...d, currency: c }))} className={chip(draft.currency === c)}>
                {c === 'all' ? 'Todas' : c}
              </button>
            ))}
          </div>
        </div>

        {/* Precio */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Precio</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={draft.priceMin}
              onChange={(e) => setDraft((d) => ({ ...d, priceMin: e.target.value }))}
              placeholder="Mín"
              className="input-line text-base"
            />
            <span className="text-neutral-600">—</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={draft.priceMax}
              onChange={(e) => setDraft((d) => ({ ...d, priceMax: e.target.value }))}
              placeholder="Máx"
              className="input-line text-base"
            />
          </div>
        </div>

        {/* Condición */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Condición</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(conditionLabels) as ListingCondition[]).map((c) => (
              <button key={c} onClick={() => toggleCondition(c)} className={chip(draft.conditions.includes(c))}>
                {conditionLabels[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Distancia */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Distancia</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => pickRadius(null)} className={chip(draft.radiusKm === null)}>
              Cualquiera
            </button>
            {RADII.map((km) => (
              <button key={km} onClick={() => pickRadius(km)} className={chip(draft.radiusKm === km)}>
                {km} km
              </button>
            ))}
          </div>
          {locationDenied && (
            <p className="mt-2 text-xs text-neutral-500">Necesitamos tu ubicación para filtrar por distancia.</p>
          )}
        </div>

        {/* Filtros propios de la categoría elegida (select / boolean) */}
        {(categoryFields ?? []).map((f) => (
          <div key={f.key}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">{f.label}</p>
            {f.type === 'boolean' ? (
              <div className="flex gap-1.5">
                <button onClick={() => setFieldFilter(f.key, null)} className={chip(draft.fields[f.key] === undefined)}>
                  Cualquiera
                </button>
                <button onClick={() => setFieldFilter(f.key, 'true')} className={chip(draft.fields[f.key] === 'true')}>
                  Sí
                </button>
                <button onClick={() => setFieldFilter(f.key, 'false')} className={chip(draft.fields[f.key] === 'false')}>
                  No
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFieldFilter(f.key, null)} className={chip(draft.fields[f.key] === undefined)}>
                  Cualquiera
                </button>
                {f.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFieldFilter(f.key, draft.fields[f.key] === opt ? null : opt)}
                    className={chip(draft.fields[f.key] === opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Acciones */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setDraft(EMPTY_FILTERS)}
            className="flex-1 rounded-full py-3 text-sm font-semibold text-neutral-300 ring-1 ring-neutral-700"
          >
            Limpiar
          </button>
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="flex-1 rounded-full bg-white py-3 text-sm font-semibold text-black"
          >
            Ver resultados
          </button>
        </div>
      </div>
    </Modal>
  )
}
