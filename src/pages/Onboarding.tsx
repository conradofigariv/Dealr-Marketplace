import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { requestBuyerLocation, reverseGeocode, cacheBuyerLabel, type LatLng } from '../lib/geo'

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9_. ]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 30)
}

// Encuesta r\u00e1pida de atribuci\u00f3n: de d\u00f3nde nos conoci\u00f3. Se guarda en
// signup_surveys (00031). Opcional: no bloquea el alta.
const SURVEY_SOURCES = ['Instagram', 'TikTok', 'Un amigo', 'Google', 'Facebook', 'Otro']

// Primer ingreso: elegir nombre de usuario antes de usar la app.
// Reemplaza el "usuario_a1b2c3" autogenerado en el registro.
export default function Onboarding() {
  const navigate = useNavigate()
  const { session, refreshProfile } = useAuth()
  // Si vino por Google, sugerimos un nombre derivado del suyo en vez de
  // arrancar de cero.
  const [username, setUsername] = useState(() => {
    const meta = session?.user.user_metadata as { full_name?: string; name?: string } | undefined
    const suggestion = meta?.full_name ?? meta?.name
    return suggestion ? normalize(suggestion) : ''
  })
  const [zone, setZone] = useState('')
  const [loc, setLoc] = useState<LatLng | null>(null)
  const [locating, setLocating] = useState(false)
  const [source, setSource] = useState('')
  const [sourceDetail, setSourceDetail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = /^[a-z0-9_.]{3,30}$/.test(username)

  async function useMyLocation() {
    setLocating(true)
    const got = await requestBuyerLocation()
    if (got) {
      setLoc(got)
      const label = await reverseGeocode(got)
      if (label) {
        setZone(label)
        cacheBuyerLabel(label)
      }
    }
    setLocating(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!session || !valid) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({
        username,
        zone: zone.trim() || null,
        ...(loc ? { lat: loc.lat, lng: loc.lng } : {}),
      })
      .eq('id', session.user.id)
    if (err) {
      setBusy(false)
      setError(
        err.code === '23505' || /unique|duplicate/i.test(err.message)
          ? 'Ese nombre ya está en uso. Probá con otro.'
          : 'No pudimos guardar el nombre. Probá de nuevo.',
      )
      return
    }
    // Encuesta de atribución (opcional): no bloquea el alta si falla.
    if (source) {
      await supabase.from('signup_surveys').insert({
        user_id: session.user.id,
        source,
        detail: source === 'Otro' ? sourceDetail.trim() || null : null,
      })
    }
    setBusy(false)
    await refreshProfile()
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-black px-8">
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">Elegí tu nombre</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Así te van a ver compradores y vendedores. Lo podés cambiar después.
        </p>

        <form onSubmit={submit} className="mt-12 space-y-8">
          <div>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(normalize(e.target.value))}
              placeholder="tu_nombre"
              className="input-line text-lg"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {/* Hint en vivo: antes el botón quedaba gris sin explicación. */}
            {username.length > 0 && !valid ? (
              <p className="mt-2 text-xs text-amber-400">
                {username.length < 3
                  ? 'Te faltan letras: mínimo 3 caracteres.'
                  : username.length > 30
                    ? 'Muy largo: máximo 30 caracteres.'
                    : 'Solo letras minúsculas, números, punto y guión bajo.'}
              </p>
            ) : (
              <p className="mt-2 text-xs text-neutral-500">
                Entre 3 y 30 caracteres. Letras, números, punto y guión bajo.
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-500">
              Tu zona <span className="normal-case text-neutral-700">(opcional)</span>
            </label>
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Ej: Nueva Córdoba"
              maxLength={60}
              className="input-line"
            />
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="mt-3 flex items-center gap-1.5 text-sm font-medium text-neutral-300 transition active:text-white disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
              {locating ? 'Ubicando…' : 'Usar mi ubicación'}
            </button>
            <p className="mt-2 text-xs text-neutral-600">
              Sirve para mostrarte lo que está cerca. Se usa de forma aproximada.
            </p>
          </div>

          <div>
            <label className="mb-3 block text-xs font-medium uppercase tracking-wider text-neutral-500">
              ¿Cómo nos conociste? <span className="normal-case text-neutral-700">(opcional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {SURVEY_SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(source === s ? '' : s)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    source === s ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {source === 'Otro' && (
              <input
                value={sourceDetail}
                onChange={(e) => setSourceDetail(e.target.value)}
                placeholder="Contanos dónde"
                maxLength={80}
                className="input-line mt-3 text-sm"
              />
            )}
          </div>

          <button disabled={busy || !valid} className="btn-primary">
            {busy ? 'Guardando…' : 'Continuar'}
          </button>
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  )
}
