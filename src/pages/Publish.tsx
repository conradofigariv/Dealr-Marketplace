import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { compressPhoto } from '../lib/images'
import { conditionLabels } from '../lib/format'
import type { Category, FieldDef, ListingCondition, Currency } from '../lib/types'

const MAX_PHOTOS = 6

interface PendingPhoto {
  file?: File // nueva foto, todavía sin subir
  path?: string // foto existente (modo edición)
  preview: string
}

export default function Publish() {
  const { id } = useParams<{ id?: string }>() // presente => editar
  const navigate = useNavigate()
  const { session, loading } = useAuth()

  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState<Currency>('ARS')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [condition, setCondition] = useState<ListingCondition>('buen_estado')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  )
  const fieldDefs: FieldDef[] = category?.required_fields ?? []

  useEffect(() => {
    if (!loading && !session) navigate('/auth')
  }, [loading, session, navigate])

  useEffect(() => {
    supabase.from('categories').select('*').order('name').then(({ data }) => setCategories(data ?? []))
  }, [])

  useEffect(() => {
    if (!id) return
    supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setTitle(data.title)
        setDescription(data.description)
        setPrice(String(data.price))
        setCurrency(data.currency)
        setCategoryId(data.category_id)
        setCondition(data.condition)
        setFields(data.structured_fields ?? {})
        setPhotos(data.photos.map((p: string) => ({ path: p, preview: photoUrl(p) })))
      })
  }, [id])

  async function addPhotos(files: FileList | null) {
    if (!files) return
    const remaining = MAX_PHOTOS - photos.length
    const selected = Array.from(files).slice(0, remaining)
    const compressed = await Promise.all(selected.map(compressPhoto))
    setPhotos((prev) => [
      ...prev,
      ...compressed.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ])
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  function validateFields(): string | null {
    for (const def of fieldDefs) {
      if (!def.required) continue
      const value = fields[def.key]
      const empty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (def.type !== 'boolean' && empty) return `Completá el campo "${def.label}"`
      if (def.type === 'boolean' && value === undefined) return `Indicá "${def.label}"`
    }
    return null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setError('')
    if (!categoryId) return setError('Elegí una categoría')
    if (photos.length === 0) return setError('Subí al menos una foto')
    const fieldError = validateFields()
    if (fieldError) return setError(fieldError)

    setBusy(true)
    try {
      const paths: string[] = []
      for (const photo of photos) {
        if (photo.path) {
          paths.push(photo.path)
          continue
        }
        const path = `${session.user.id}/${crypto.randomUUID()}.webp`
        const { error: upErr } = await supabase.storage
          .from('listing-photos')
          .upload(path, photo.file!, { contentType: 'image/webp' })
        if (upErr) throw upErr
        paths.push(path)
      }

      const payload = {
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        currency,
        category_id: categoryId,
        condition,
        structured_fields: fields,
        photos: paths,
      }

      if (id) {
        const { error: err } = await supabase.from('listings').update(payload).eq('id', id)
        if (err) throw err
        navigate(`/p/${id}`)
      } else {
        const { data, error: err } = await supabase
          .from('listings')
          .insert({ ...payload, seller_id: session.user.id })
          .select('id')
          .single()
        if (err) throw err
        navigate(`/p/${data.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo salió mal, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  function setField(key: string, value: unknown) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  const inputClass =
    'w-full rounded-xl border border-gray-200 px-4 py-3 text-base outline-none focus:border-brand-500 bg-white'

  return (
    <div className="pb-24">
      <header className="bg-brand-700 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-xl font-extrabold text-white">{id ? 'Editar publicación' : 'Vender'}</h1>
      </header>

      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {/* Fotos */}
        <div>
          <label className="mb-1.5 block text-sm font-semibold">Fotos ({photos.length}/{MAX_PHOTOS})</label>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-gray-100">
                <img src={photo.preview} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label="Quitar foto"
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 text-gray-400">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="text-[10px] font-medium">Agregar</span>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
              </label>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400">Se comprimen automáticamente. La primera es la portada.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold">Título</label>
          <input required minLength={4} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: iPhone 13 128GB" className={inputClass} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold">Descripción</label>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Estado, uso, accesorios incluidos..." className={inputClass} />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-semibold">Precio</label>
            <input required type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Moneda</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputClass}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold">Categoría</label>
          <select
            required
            value={categoryId}
            onChange={(e) => {
              setCategoryId(Number(e.target.value))
              setFields({})
            }}
            className={inputClass}
          >
            <option value="" disabled>Elegí una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold">Condición</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(conditionLabels) as ListingCondition[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`rounded-xl py-2.5 text-sm font-semibold ${
                  condition === c ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                }`}
              >
                {conditionLabels[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Campos estructurados obligatorios por categoría */}
        {fieldDefs.map((def) => (
          <div key={def.key}>
            <label className="mb-1.5 block text-sm font-semibold">
              {def.label}
              {!def.required && <span className="ml-1 font-normal text-gray-400">(opcional)</span>}
            </label>
            {def.type === 'text' && (
              <input
                value={(fields[def.key] as string) ?? ''}
                onChange={(e) => setField(def.key, e.target.value)}
                className={inputClass}
              />
            )}
            {def.type === 'select' && (
              <select
                value={(fields[def.key] as string) ?? ''}
                onChange={(e) => setField(def.key, e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>Elegir…</option>
                {def.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
            {def.type === 'multiselect' && (
              <div className="flex flex-wrap gap-2">
                {def.options?.map((opt) => {
                  const selected = ((fields[def.key] as string[]) ?? []).includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        const current = (fields[def.key] as string[]) ?? []
                        setField(def.key, selected ? current.filter((o) => o !== opt) : [...current, opt])
                      }}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        selected ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                      }`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}
            {def.type === 'boolean' && (
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setField(def.key, v)}
                    className={`rounded-xl py-2.5 text-sm font-semibold ${
                      fields[def.key] === v ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                    }`}
                  >
                    {v ? 'Sí' : 'No'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-brand-700 py-3.5 font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Publicando…' : id ? 'Guardar cambios' : 'Publicar'}
        </button>
      </form>
    </div>
  )
}
