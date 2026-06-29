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
  // Filtros por rango numérico (Año, Kilómetros, Superficie…). key del campo ->
  // columna generada a comparar + mín/máx (strings del input, '' = sin tope).
  fieldRanges: Record<string, { column: string; min: string; max: string }>
  // Filtros multiselect (amenities). key del campo -> opciones elegidas; el
  // aviso tiene que tener TODAS las elegidas (contención jsonb @>).
  multi: Record<string, string[]>
}

export const EMPTY_FILTERS: FeedFilterValues = {
  priceMin: '',
  priceMax: '',
  currency: 'all',
  conditions: [],
  radiusKm: null,
  fields: {},
  fieldRanges: {},
  multi: {},
}

export function countActiveFilters(f: FeedFilterValues): number {
  return (
    (f.priceMin ? 1 : 0) +
    (f.priceMax ? 1 : 0) +
    (f.currency !== 'all' ? 1 : 0) +
    (f.conditions.length ? 1 : 0) +
    (f.radiusKm ? 1 : 0) +
    Object.keys(f.fields).length +
    Object.values(f.fieldRanges).filter((r) => r.min || r.max).length +
    Object.values(f.multi).filter((arr) => arr.length).length
  )
}

// Son buenos filtros los campos de opciones cerradas (select/boolean/
// multiselect) y los numéricos con rango (filterRange). El texto libre no.
export function filterableFields(fields: FieldDef[] | undefined): FieldDef[] {
  return (fields ?? []).filter(
    (f) =>
      f.type === 'select' ||
      f.type === 'boolean' ||
      f.type === 'multiselect' ||
      Boolean(f.filterRange) ||
      Boolean(f.filterSlider) ||
      Boolean(f.filterMaxChips),
  )
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
  // Orden + "solo verificados": se manejan acá adentro (antes estaban en la
  // fila de categorías). Aplican en vivo (no por el botón "Aplicar").
  order: string
  orderOptions: { value: string; label: string }[]
  onOrder: (value: string) => void
  onlyVerified: boolean
  onVerified: (value: boolean) => void
  onClose: () => void
}

export default function FeedFilters({
  value,
  onApply,
  ensureLocation,
  categoryFields,
  order,
  orderOptions,
  onOrder,
  onlyVerified,
  onVerified,
  onClose,
}: Props) {
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

  // Agrega/saca una opción de un filtro multiselect. Si queda vacío, lo limpia.
  function toggleMulti(key: string, opt: string) {
    setDraft((d) => {
      const multi = { ...d.multi }
      const current = multi[key] ?? []
      const next = current.includes(opt) ? current.filter((o) => o !== opt) : [...current, opt]
      if (next.length) multi[key] = next
      else delete multi[key]
      return { ...d, multi }
    })
  }

  // Setea el mín/máx de un filtro de rango. Si ambos quedan vacíos, lo limpia.
  function setFieldRange(key: string, column: string, part: 'min' | 'max', value: string) {
    setDraft((d) => {
      const fieldRanges = { ...d.fieldRanges }
      const prev = fieldRanges[key] ?? { column, min: '', max: '' }
      const next = { ...prev, column, [part]: value }
      if (!next.min && !next.max) delete fieldRanges[key]
      else fieldRanges[key] = next
      return { ...d, fieldRanges }
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
        {/* Ordenar (aplica en vivo) */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Ordenar por</p>
          <div className="flex flex-wrap gap-1.5">
            {orderOptions.map((o) => (
              <button key={o.value} onClick={() => onOrder(o.value)} className={chip(order === o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Solo verificados (aplica en vivo) */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">Solo verificados</p>
            <p className="mt-0.5 text-xs text-neutral-500">Publicaciones de gente con identidad validada</p>
          </div>
          <button
            role="switch"
            aria-checked={onlyVerified}
            aria-label="Solo verificados"
            onClick={() => onVerified(!onlyVerified)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${onlyVerified ? 'bg-white' : 'bg-neutral-700'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition ${onlyVerified ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </div>

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

        {/* Filtros propios de la categoría elegida (rango / select / boolean) */}
        {(categoryFields ?? []).map((f) => (
          <div key={f.key}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">{f.label}</p>
            {f.filterSlider ? (
              <div>
                <p className="mb-1 text-sm text-neutral-300">
                  {Number(draft.fieldRanges[f.key]?.[f.filterSlider.bound] ?? f.filterSlider.min) <= f.filterSlider.min
                    ? 'Cualquiera'
                    : `${f.filterSlider.bound === 'min' ? 'Desde' : 'Hasta'} ${draft.fieldRanges[f.key]?.[f.filterSlider.bound]} ${f.filterSlider.unit ?? ''}`}
                </p>
                <input
                  type="range"
                  min={f.filterSlider.min}
                  max={f.filterSlider.max}
                  step={f.filterSlider.step}
                  value={Number(draft.fieldRanges[f.key]?.[f.filterSlider.bound] ?? f.filterSlider.min)}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setFieldRange(f.key, f.filterSlider!.column, f.filterSlider!.bound, v <= f.filterSlider!.min ? '' : String(v))
                  }}
                  className="w-full accent-white"
                />
              </div>
            ) : f.filterMaxChips ? (
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFieldRange(f.key, f.filterMaxChips!.column, 'max', '')} className={chip(!draft.fieldRanges[f.key]?.max)}>
                  Cualquiera
                </button>
                {f.filterMaxChips.options.map((o) => (
                  <button
                    key={o.value}
                    onClick={() =>
                      setFieldRange(f.key, f.filterMaxChips!.column, 'max', draft.fieldRanges[f.key]?.max === String(o.value) ? '' : String(o.value))
                    }
                    className={chip(draft.fieldRanges[f.key]?.max === String(o.value))}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : f.filterRange ? (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={draft.fieldRanges[f.key]?.min ?? ''}
                  onChange={(e) => setFieldRange(f.key, f.filterRange!.column, 'min', e.target.value)}
                  placeholder="Mín"
                  className="input-line text-base"
                />
                <span className="text-neutral-600">—</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={draft.fieldRanges[f.key]?.max ?? ''}
                  onChange={(e) => setFieldRange(f.key, f.filterRange!.column, 'max', e.target.value)}
                  placeholder="Máx"
                  className="input-line text-base"
                />
              </div>
            ) : f.type === 'boolean' ? (
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
            ) : f.type === 'multiselect' ? (
              <div className="flex flex-wrap gap-1.5">
                {f.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => toggleMulti(f.key, opt)}
                    className={chip((draft.multi[f.key] ?? []).includes(opt))}
                  >
                    {opt}
                  </button>
                ))}
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
            onClick={() => {
              setDraft(EMPTY_FILTERS)
              onVerified(false)
              if (orderOptions[0]) onOrder(orderOptions[0].value) // vuelve a "Recientes"
            }}
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
