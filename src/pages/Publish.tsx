import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { compressPhoto } from '../lib/images'
import { capture } from '../lib/analytics'
import { conditionLabels, formatPrice } from '../lib/format'
import type { Category, FieldDef, ListingCondition, Currency } from '../lib/types'
import type { LatLng } from '../lib/geo'
import LocationPicker from '../components/LocationPicker'

const MAX_PHOTOS = 6

interface PendingPhoto {
  file?: File // nueva foto, todavía sin subir
  path?: string // foto existente (modo edición)
  preview: string
}

export default function Publish() {
  const { id } = useParams<{ id?: string }>() // presente => editar
  const navigate = useNavigate()
  const { session, profile, loading } = useAuth()

  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState<Currency>('ARS')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [condition, setCondition] = useState<ListingCondition>('buen_estado')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [addingPhotos, setAddingPhotos] = useState(false)
  const [location, setLocation] = useState<LatLng | null>(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [publishedId, setPublishedId] = useState<string | null>(null)

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  )
  const fieldDefs: FieldDef[] = category?.required_fields ?? []

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: id ? `/publicar/${id}` : '/publicar', back: '/' } })
  }, [loading, session, id, navigate])

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
        if (data.lat != null && data.lng != null) {
          setLocation({ lat: data.lat, lng: data.lng })
          setLocationLabel(data.location_label ?? '')
        }
      })
  }, [id])

  // Publicación nueva: precargar la ubicación por defecto del perfil (la que
  // quedó guardada la última vez), para que publicar sea de un toque.
  useEffect(() => {
    if (id || location || !profile) return
    if (profile.lat != null && profile.lng != null) {
      setLocation({ lat: profile.lat, lng: profile.lng })
      setLocationLabel(profile.zone ?? '')
    }
  }, [id, profile, location])

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    const remaining = MAX_PHOTOS - photos.length
    const selected = Array.from(files).slice(0, remaining)
    setAddingPhotos(true)
    try {
      const compressed = await Promise.all(selected.map(compressPhoto))
      setPhotos((prev) => [
        ...prev,
        ...compressed.map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ])
    } catch {
      setError('No pudimos procesar esa foto. Probá con otra.')
    } finally {
      setAddingPhotos(false)
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  // Mover una foto un lugar hacia adelante: tocando repetido se llega
  // a portada. Más confiable que drag & drop en pantallas táctiles.
  function movePhotoLeft(index: number) {
    if (index === 0) return
    setPhotos((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
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
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        location_label: locationLabel.trim() || null,
      }

      // Guardar la ubicación elegida como default del perfil si todavía no
      // tiene una, así la próxima publicación arranca precargada.
      if (location && profile && profile.lat == null) {
        await supabase
          .from('profiles')
          .update({ lat: location.lat, lng: location.lng, zone: profile.zone ?? (locationLabel.trim() || null) })
          .eq('id', session.user.id)
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
        capture('listing_published', { category_id: categoryId, currency })
        window.scrollTo(0, 0)
        setPublishedId(data.id)
      }
    } catch (err) {
      // Los errores de Supabase son objetos {message, details, hint, code},
      // no instancias de Error: hay que leer sus campos a mano.
      const e = err as { message?: string; details?: string; hint?: string; code?: string } | null
      const message = e?.message ?? (err instanceof Error ? err.message : '')
      const full = [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(' · ') || JSON.stringify(err)
      setError(
        /network|fetch/i.test(message)
          ? 'Problema de conexión. Revisá tu internet y probá de nuevo — las fotos no se pierden.'
          : /column|schema cache|does not exist|could not find/i.test(message)
            ? `Falta aplicar una migración en Supabase (una columna no existe): ${full}`
            : `No pudimos publicar: ${full}`,
      )
    } finally {
      setBusy(false)
    }
  }

  // Compartir la publicación recién creada: share nativo si existe
  // (abre la hoja del sistema), si no directo a WhatsApp.
  function share() {
    const url = `${window.location.origin}/p/${publishedId}`
    const text = `${title.trim()} — ${formatPrice(Number(price), currency)}\n${url}`
    if (navigator.share) {
      navigator.share({ text }).catch(() => {})
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    }
  }

  function setField(key: string, value: unknown) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  const labelClass = 'mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-500'

  if (publishedId) {
    return (
      <div className="flex min-h-dvh flex-col justify-center px-8 pb-28 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white text-black">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">¡Publicado!</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-400">
          Tu publicación ya está visible para todos. Compartila para venderla más rápido.
        </p>
        <div className="mt-10 space-y-4">
          <button onClick={share} className="btn-primary flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1a14 14 0 0 1-1.5-.5c-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2 .2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.7 1.2 1.5 1.9 1 .9 1.9 1.2 2.2 1.4.3.1.4.1.6-.1l.7-.9c.2-.3.4-.2.7-.1l1.8.8c.3.2.5.2.5.4.1.1.1.6-.1 1.1z" />
            </svg>
            Compartir por WhatsApp
          </button>
          <Link to={`/p/${publishedId}`} className="btn-outline block py-3 text-center text-sm">
            Ver mi publicación
          </Link>
          <button
            onClick={() => {
              setPublishedId(null)
              setTitle('')
              setDescription('')
              setPrice('')
              setCategoryId('')
              setCondition('buen_estado')
              setFields({})
              setPhotos([])
              setLocation(null)
              setLocationLabel('')
              setError('')
            }}
            className="w-full py-2 text-center text-sm text-neutral-500"
          >
            Publicar otra cosa
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-32">
      <header className="px-5 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">{id ? 'Editar' : 'Vender'}</h1>
      </header>

      <form onSubmit={submit} className="space-y-7 px-5 py-4">
        {/* Fotos */}
        <div>
          <label className={labelClass}>Fotos ({photos.length}/{MAX_PHOTOS})</label>
          <div className="grid grid-cols-3 gap-1">
            {photos.map((photo, i) => (
              <div key={photo.preview} className="relative aspect-square overflow-hidden bg-neutral-900">
                <img src={photo.preview} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label="Quitar foto"
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white backdrop-blur-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
                {i === 0 ? (
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    Portada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => movePhotoLeft(i)}
                    aria-label="Mover foto hacia adelante"
                    className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 p-1.5 text-white backdrop-blur-sm"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5m7-7-7 7 7 7" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="flex aspect-square cursor-pointer items-center justify-center bg-neutral-900 text-neutral-600 transition active:bg-neutral-800">
                {addingPhotos ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
                <input type="file" accept="image/*" multiple hidden disabled={addingPhotos} onChange={(e) => addPhotos(e.target.files)} />
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-neutral-600">
            Se comprimen automáticamente. La primera es la portada — usá la flecha para reordenar.
          </p>
        </div>

        <div>
          <label className={labelClass}>Título</label>
          <input required minLength={4} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: iPhone 13 128GB" className="input-line" />
        </div>

        <div>
          <label className={labelClass}>Descripción</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Estado, uso, accesorios incluidos…" className="input-line resize-none" />
        </div>

        <div className="flex items-end gap-6">
          <div className="flex-1">
            <label className={labelClass}>Precio</label>
            <input required type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className="input-line text-xl font-semibold" />
          </div>
          <div className="flex gap-1.5 pb-1">
            {(['ARS', 'USD'] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`chip ${currency === c ? 'chip-on' : 'chip-off'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Categoría</label>
          <select
            required
            value={categoryId}
            onChange={(e) => {
              setCategoryId(Number(e.target.value))
              setFields({})
            }}
            className="input-line appearance-none"
          >
            <option value="" disabled>Elegí una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} className="bg-neutral-900">{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Condición</label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(conditionLabels) as ListingCondition[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`chip ${condition === c ? 'chip-on' : 'chip-off'}`}
              >
                {conditionLabels[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Ubicación: se muestra como área aproximada en la publicación */}
        <div>
          <label className={labelClass}>Ubicación</label>
          <LocationPicker
            value={location}
            onChange={(loc, label) => {
              setLocation(loc)
              if (label !== undefined) setLocationLabel(label)
            }}
          />
          <p className="mt-2 text-xs text-neutral-600">
            {locationLabel ? (
              <>
                <span className="text-neutral-400">{locationLabel}</span> · solo se muestra el área aproximada, nunca el punto exacto.
              </>
            ) : (
              'Solo se muestra el área aproximada, nunca el punto exacto.'
            )}
          </p>
        </div>

        {/* Campos estructurados obligatorios por categoría */}
        {fieldDefs.map((def) => (
          <div key={def.key}>
            <label className={labelClass}>
              {def.label}
              {!def.required && <span className="ml-1 normal-case text-neutral-700">(opcional)</span>}
            </label>
            {def.type === 'text' && (
              <input
                value={(fields[def.key] as string) ?? ''}
                onChange={(e) => setField(def.key, e.target.value)}
                className="input-line"
              />
            )}
            {def.type === 'select' && (
              <select
                value={(fields[def.key] as string) ?? ''}
                onChange={(e) => setField(def.key, e.target.value)}
                className="input-line appearance-none"
              >
                <option value="" disabled>Elegir…</option>
                {def.options?.map((opt) => (
                  <option key={opt} value={opt} className="bg-neutral-900">{opt}</option>
                ))}
              </select>
            )}
            {def.type === 'multiselect' && (
              <div className="flex flex-wrap gap-1.5">
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
                      className={`chip ${selected ? 'chip-on' : 'chip-off'}`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}
            {def.type === 'boolean' && (
              <div className="flex gap-1.5">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setField(def.key, v)}
                    className={`chip ${fields[def.key] === v ? 'chip-on' : 'chip-off'}`}
                  >
                    {v ? 'Sí' : 'No'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button disabled={busy} className="btn-primary">
          {busy ? 'Publicando…' : id ? 'Guardar cambios' : 'Publicar'}
        </button>
      </form>
    </div>
  )
}
