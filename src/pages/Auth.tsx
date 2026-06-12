import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../lib/authErrors'

type Channel = 'email' | 'phone'

// El login por SMS queda oculto hasta configurar el proveedor (Twilio).
const phoneEnabled = import.meta.env.VITE_ENABLE_PHONE_AUTH === 'true'

const RESEND_SECONDS = 60

export default function Auth() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [channel, setChannel] = useState<Channel>('email')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState('')
  const [rawError, setRawError] = useState('')
  const [busy, setBusy] = useState(false)

  // Si la sesión aparece (tocó el magic link), entrar automáticamente
  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  // El teléfono verificado es la señal de confianza base de Dealr.
  function normalizedPhone() {
    const digits = identifier.replace(/[^\d+]/g, '')
    return digits.startsWith('+') ? digits : `+54${digits}`
  }

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    setRawError('')
    const { error: err } =
      channel === 'phone'
        ? await supabase.auth.signInWithOtp({ phone: normalizedPhone() })
        : await supabase.auth.signInWithOtp({
            email: identifier.trim(),
            options: { emailRedirectTo: window.location.origin },
          })
    setBusy(false)
    if (err) {
      setError(translateAuthError(err.message))
      setRawError(err.message)
    } else {
      setLinkSent(true)
      setResendIn(RESEND_SECONDS)
    }
  }

  async function verifyPhoneCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setRawError('')
    const { error: err } = await supabase.auth.verifyOtp({
      phone: normalizedPhone(),
      token: code.trim(),
      type: 'sms',
    })
    setBusy(false)
    if (err) {
      setError(translateAuthError(err.message))
      setRawError(err.message)
    } else navigate('/')
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-black px-8">
      <button
        onClick={() => navigate('/')}
        aria-label="Volver"
        className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] p-2 text-white"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18 9 12l6-6" />
        </svg>
      </button>

      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-16 text-center text-6xl font-bold tracking-tight text-white">Dealr</h1>

        {!linkSent ? (
          <form onSubmit={send} className="space-y-8">
            <input
              type={channel === 'phone' ? 'tel' : 'email'}
              required
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={channel === 'phone' ? 'Tu teléfono' : 'Tu email'}
              autoCapitalize="none"
              autoCorrect="off"
              className="input-line text-lg"
            />
            <button disabled={busy} className="btn-primary">
              {busy ? 'Enviando…' : 'Continuar'}
            </button>
            {phoneEnabled && (
              <button
                type="button"
                onClick={() => {
                  setChannel(channel === 'email' ? 'phone' : 'email')
                  setError('')
                }}
                className="w-full text-center text-sm text-neutral-500"
              >
                {channel === 'email' ? 'Usar mi teléfono' : 'Usar mi email'}
              </button>
            )}
          </form>
        ) : channel === 'email' ? (
          <div className="space-y-8 text-center">
            <p className="text-neutral-400">
              Te enviamos un link a <strong className="text-white">{identifier}</strong>.
              <br />
              Abrilo para entrar.
            </p>
            <div className="flex justify-center">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            </div>
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => send()}
              className="w-full text-center text-sm text-neutral-500 disabled:opacity-60"
            >
              {resendIn > 0 ? `Reenviar en ${resendIn}s` : 'Reenviar el link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setLinkSent(false)
                setError('')
                setRawError('')
              }}
              className="w-full text-center text-sm text-neutral-500"
            >
              Cambiar email
            </button>
          </div>
        ) : (
          <form onSubmit={verifyPhoneCode} className="space-y-8">
            <p className="text-center text-neutral-400">
              Revisá tu teléfono, te enviamos un código.
            </p>
            <input
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Código"
              className="input-line text-center text-2xl tracking-[0.5em]"
            />
            <button disabled={busy} className="btn-primary">
              {busy ? 'Verificando…' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setLinkSent(false)
                setCode('')
                setError('')
                setRawError('')
              }}
              className="w-full text-center text-sm text-neutral-500"
            >
              Volver
            </button>
          </form>
        )}
        {error && (
          <div className="mt-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
            {rawError && <p className="mt-1 text-xs text-neutral-600">{rawError}</p>}
          </div>
        )}
      </div>

      <p className="pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-neutral-500">
        Al continuar aceptás nuestros Términos y la Política de privacidad
      </p>
    </div>
  )
}
