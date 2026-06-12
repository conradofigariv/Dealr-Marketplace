import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// Primer ingreso: elegir nombre de usuario antes de usar la app.
// Reemplaza el "usuario_a1b2c3" autogenerado en el registro.
export default function Onboarding() {
  const navigate = useNavigate()
  const { session, refreshProfile } = useAuth()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, '').slice(0, 30)
  }

  const valid = /^[a-z0-9_.]{3,30}$/.test(username)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!session || !valid) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ username })
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
          <button disabled={busy || !valid} className="btn-primary">
            {busy ? 'Guardando…' : 'Continuar'}
          </button>
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  )
}
