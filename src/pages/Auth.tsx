import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Channel = 'phone' | 'email'

export default function Auth() {
  const navigate = useNavigate()
  const [channel, setChannel] = useState<Channel>('phone')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // El teléfono verificado es la señal de confianza base de Dealr.
  function normalizedPhone() {
    const digits = identifier.replace(/[^\d+]/g, '')
    return digits.startsWith('+') ? digits : `+54${digits}`
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } =
      channel === 'phone'
        ? await supabase.auth.signInWithOtp({ phone: normalizedPhone() })
        : await supabase.auth.signInWithOtp({ email: identifier.trim() })
    setBusy(false)
    if (err) setError(err.message)
    else setCodeSent(true)
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } =
      channel === 'phone'
        ? await supabase.auth.verifyOtp({ phone: normalizedPhone(), token: code, type: 'sms' })
        : await supabase.auth.verifyOtp({ email: identifier.trim(), token: code, type: 'email' })
    setBusy(false)
    if (err) setError(err.message)
    else navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-brand-700 px-6 pt-[max(4rem,env(safe-area-inset-top))]">
      <h1 className="text-4xl font-extrabold text-white">Dealr</h1>
      <p className="mt-2 text-brand-100">Comprá y vendé usados en Córdoba, con confianza.</p>

      <div className="mt-10 rounded-2xl bg-white p-5">
        <div className="mb-5 grid grid-cols-2 rounded-full bg-gray-100 p-1 text-sm font-semibold">
          {(['phone', 'email'] as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                setChannel(c)
                setCodeSent(false)
                setError('')
              }}
              className={`rounded-full py-2 ${channel === c ? 'bg-brand-700 text-white' : 'text-gray-500'}`}
            >
              {c === 'phone' ? 'Teléfono' : 'Email'}
            </button>
          ))}
        </div>

        {!codeSent ? (
          <form onSubmit={sendCode} className="space-y-3">
            <input
              type={channel === 'phone' ? 'tel' : 'email'}
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={channel === 'phone' ? 'Ej: 351 555 0000' : 'tu@email.com'}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base outline-none focus:border-brand-500"
            />
            {channel === 'phone' && (
              <p className="text-xs text-gray-500">
                Te enviamos un código por SMS. Tu número no se muestra públicamente.
              </p>
            )}
            <button
              disabled={busy}
              className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-sm text-gray-600">
              Ingresá el código que te enviamos a <strong>{identifier}</strong>
            </p>
            <input
              inputMode="numeric"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-xl tracking-[0.4em] outline-none focus:border-brand-500"
            />
            <button
              disabled={busy}
              className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Verificando…' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => setCodeSent(false)}
              className="w-full py-1 text-sm text-gray-500"
            >
              Volver
            </button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <button onClick={() => navigate('/')} className="mt-6 text-sm text-brand-100 underline">
        Seguir mirando sin cuenta
      </button>
    </div>
  )
}
