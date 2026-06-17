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
    setBusy(false)
    if (err) {
      setError(
        err.code === '23505' || /unique|duplicate/i.test(err.message)
          ? 'Ese nombre ya está en uso. Probá con otro.'
          : 'No pudimos guardar el nombre. Probá de nuevo.',
      )
      return
    }
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
            <p className="mt-2 text-xs text-neutral-600">
              Entre 3 y 30 caracteres. Letras, números, punto y guión bajo.
            </p>
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

          <button disabled={busy || !valid} className="btn-primary">
            {busy ? 'Guardando…' : 'Continuar'}
          </button>
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  )
}
