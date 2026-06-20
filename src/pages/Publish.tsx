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
import { invalidateFeedCache } from './Home'

const MAX_PHOTOS = 6

const WIZARD_STEPS = [
  { name: 'Fotos', title: 'Mostrá tu producto', subtitle: 'Subí hasta 6 fotos. La primera es la portada.' },
  { name: 'Detalles', title: 'Contá los detalles', subtitle: 'Categoría, condición y una buena descripción.' },
  { name: 'Precio', title: 'Poné el precio', subtitle: 'Precio fijo o subasta — vos elegís.' },
  { name: 'Entrega', title: '¿Dónde lo entregás?', subtitle: 'Solo se muestra el área aproximada.' },
]

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
  const [isAuction, setIsAuction] = useState(false)
  const [auctionDays, setAuctionDays] = useState(3)
  const [auctionCascade, setAuctionCascade] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [stepDir, setStepDir] = useState<'fwd' | 'back'>('fwd')

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

  // Wizard de publicación (solo al crear): 4 pasos con validación propia.
  function stepError(s: number): string | null {
    if (s === 1) {
      if (photos.length === 0) return 'Subí al menos una foto'
      if (title.trim().length < 4) return 'Poné un título de al menos 4 letras'
    }
    if (s === 2) {
      if (!categoryId) return 'Elegí una categoría'
      return validateFields()
    }
    if (s === 3) {
      if (!price || Number(price) <= 0) return 'Poné un precio'
    }
    return null
  }

  function goNext() {
    const err = stepError(step)
    if (err) return setError(err)
    setError('')
    window.scrollTo(0, 0)
    setStepDir('fwd')
    setStep((s) => s + 1)
  }

  function goBack() {
    setError('')
    window.scrollTo(0, 0)
    if (step === 1) navigate(-1)
    else {
      setStepDir('back')
      setStep((s) => s - 1)
    }
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
        invalidateFeedCache()
        navigate(`/p/${id}`)
      } else {
        const auctionFields = isAuction
          ? {
              is_auction: true,
              auction_ends_at: new Date(Date.now() + auctionDays * 86400000).toISOString(),
              auction_cascade: auctionCascade,
            }
          : {}
        const { data, error: err } = await supabase
          .from('listings')
          .insert({ ...payload, ...auctionFields, seller_id: session.user.id })
          .select('id')
          .single()
        if (err) throw err
        invalidateFeedCache()
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
          : /could not find|schema cache|column .* does not exist/i.test(message)
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
              setIsAuction(false)
              setAuctionDays(3)
              setAuctionCascade(false)
              setError('')
              setStep(1)
            }}
            className="w-full py-2 text-center text-sm text-neutral-500"
          >
            Publicar otra cosa
          </button>
        </div>
      </div>
    )
  }

  // ---------- Modo edición: formulario clásico en una sola pantalla ----------
  if (id) {
    return (
      <div className="pb-32">
        <header className="px-5 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <h1 className="text-2xl font-bold tracking-tight text-white">Editar</h1>
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
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    )
  }

  // ---------- Modo crear: wizard de 4 pasos ----------
  const stepInfo = WIZARD_STEPS[step - 1]
  const isLastStep = step === WIZARD_STEPS.length

  function handleWizardSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isLastStep) {
      goNext()
      return
    }
    submit(e)
  }

  return (
    <div className="pb-36">
      <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={goBack}
          aria-label="Volver"
          className="-ml-1.5 flex h-9 w-9 items-center justify-center text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19 8 12l7-7" />
          </svg>
        </button>
        <div className="mt-3 flex gap-1.5">
          {WIZARD_STEPS.map((s, i) => (
            <div key={s.name} className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: i < step ? '100%' : '0%' }}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs font-medium text-neutral-500">
          {stepInfo.name} · Paso {step} de {WIZARD_STEPS.length}
        </p>
      </header>

      <form onSubmit={handleWizardSubmit} className="px-5 py-5">
        <div key={step} className={stepDir === 'fwd' ? 'step-fwd' : 'step-back'}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">{stepInfo.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{stepInfo.subtitle}</p>
        </div>

        <div className="space-y-7">
          {/* Paso 1: Fotos + Título */}
          {step === 1 && (
            <>
              <div>
                <label className={labelClass}>Fotos ({photos.length}/{MAX_PHOTOS})</label>
                {/* Grid fijo de 6 slots: la portada (slot 0) ocupa 2x2 y el
                    resto son cuadrados chicos alrededor. Los vacíos abren el
                    selector; el primer slot vacío es la portada destacada. */}
                <div className="grid grid-cols-3 gap-1.5">
                  {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
                    const photo = photos[i]
                    const isCover = i === 0
                    const slotClass = isCover ? 'col-span-2 row-span-2' : 'aspect-square'

                    if (photo) {
                      return (
                        <div key={photo.preview} className={`relative overflow-hidden rounded-xl bg-neutral-900 ${slotClass}`}>
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
                          {isCover ? (
                            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
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
                      )
                    }

                    // Slot vacío: solo el primero disponible acepta toques (para
                    // que las fotos se llenen en orden sin huecos).
                    const isNextSlot = i === photos.length
                    return (
                      <label
                        key={`empty-${i}`}
                        className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-700 text-neutral-600 transition ${slotClass} ${
                          isNextSlot ? 'cursor-pointer active:bg-neutral-900' : 'pointer-events-none opacity-50'
                        }`}
                      >
                        {isCover && (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
                            Portada
                          </span>
                        )}
                        {isNextSlot && addingPhotos ? (
                          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" className={isCover ? 'h-8 w-8' : 'h-6 w-6'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            {isCover && <span className="text-xs font-medium">Agregar foto</span>}
                          </>
                        )}
                        {isNextSlot && (
                          <input type="file" accept="image/*" multiple hidden disabled={addingPhotos} onChange={(e) => addPhotos(e.target.files)} />
                        )}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-neutral-600">
                  {photos.length} de {MAX_PHOTOS} · se comprimen solas al subirlas. La primera es la portada — usá la flecha para reordenar.
                </p>
              </div>

              <div>
                <label className={labelClass}>Título</label>
                <input required minLength={4} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: iPhone 13 128GB" className="input-line" />
              </div>
            </>
          )}

          {/* Paso 2: Descripción + Categoría + Condición + campos por categoría */}
          {step === 2 && (
            <>
              <div>
                <label className={labelClass}>Descripción</label>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Estado, uso, accesorios incluidos…" className="input-line resize-none" />
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
            </>
          )}

          {/* Paso 3: Tipo de publicación + Precio + opciones de subasta */}
          {step === 3 && (
            <>
              <div>
                <label className={labelClass}>Tipo de publicación</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAuction(false)}
                    className={`rounded-2xl p-4 text-left ring-1 transition ${
                      !isAuction ? 'bg-white text-black ring-white' : 'bg-neutral-900 text-white ring-neutral-800'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                    <p className="mt-2.5 text-sm font-semibold">Precio fijo</p>
                    <p className={`mt-0.5 text-xs ${!isAuction ? 'text-black/60' : 'text-neutral-500'}`}>Venta directa</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAuction(true)}
                    className={`rounded-2xl p-4 text-left ring-1 transition ${
                      isAuction ? 'glow-badge bg-white text-black ring-white' : 'bg-neutral-900 text-white ring-neutral-800'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m14 12-8.5 8.5a2.12 2.12 0 1 1-3-3L11 9" />
                      <path d="M15 13 9 7l4-4 6 6-4 4Z" />
                      <path d="m17.6 13.4 3.7-3.7" />
                    </svg>
                    <p className={`mt-2.5 text-sm font-semibold ${isAuction ? 'glow-text' : ''}`}>Subasta</p>
                    <p className={`mt-0.5 text-xs ${isAuction ? 'text-black/60' : 'text-neutral-500'}`}>Mejor oferta</p>
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-6">
                <div className="flex-1">
                  <label className={labelClass}>{isAuction ? 'Precio inicial' : 'Precio'}</label>
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
              <p className="text-xs text-neutral-600">
                {isAuction
                  ? 'Los compradores ofertan a partir de este precio. Vos definís cuánto dura.'
                  : 'Los compradores también pueden hacerte una oferta para negociar.'}
              </p>

              {isAuction && (
                <div className="space-y-4 rounded-2xl bg-neutral-900/60 p-4 ring-1 ring-neutral-800">
                  <div>
                    <label className={labelClass}>Duración</label>
                    <div className="flex gap-1.5">
                      {[1, 3, 7].map((d) => (
                        <button key={d} type="button" onClick={() => setAuctionDays(d)} className={`chip ${auctionDays === d ? 'chip-on' : 'chip-off'}`}>
                          {d} {d === 1 ? 'día' : 'días'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={auctionCascade}
                      onChange={(e) => setAuctionCascade(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-white"
                    />
                    <span className="text-sm text-neutral-300">
                      Si el ganador no responde, ofrecer al siguiente postor a su precio
                    </span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* Paso 4: Ubicación */}
          {step === 4 && (
            <div>
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
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        </div>

        <div className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-lg -translate-x-1/2 items-center gap-4 bg-gradient-to-t from-black via-black/95 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
          <button type="button" onClick={goBack} className="shrink-0 text-sm font-medium text-neutral-500">
            Atrás
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex items-center justify-center gap-2">
            {busy ? 'Publicando…' : isLastStep ? 'Publicar' : 'Continuar'}
            {!busy && (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14m-6-7 7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
