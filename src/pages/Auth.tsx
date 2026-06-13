import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../lib/authErrors'
import { markWelcomeSeen } from '../lib/welcome'

type Channel = 'email' | 'phone'

// El login por SMS queda oculto hasta configurar el proveedor (Twilio).
const phoneEnabled = import.meta.env.VITE_ENABLE_PHONE_AUTH === 'true'

const RESEND_SECONDS = 60

export default function Auth() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [channel, setChannel] = useState<Channel>('email')
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState('')
  const [rawError, setRawError] = useState('')
  const [busy, setBusy] = useState(false)

  // Mostrada al menos una vez: la próxima apertura va directo al feed.
  useEffect(() => {
    markWelcomeSeen()
  }, [])

  // Si la sesión aparece (tocó el magic link), entrar automáticamente
  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function googleSignIn() {
    setBusy(true)
    setError('')
    setRawError('')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (err) {
      setBusy(false)
      setError(translateAuthError(err.message))
      setRawError(err.message)
    }
    // si no hubo error, el navegador ya está redirigiendo a Google
  }

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
    <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col overflow-hidden bg-black px-8">
      {/* Video de fondo: public/login-bg.mp4. Si el archivo no existe,
          queda el fondo negro de siempre. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        src="/login-bg.mp4"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/85" />

      <button
        onClick={() => navigate('/')}
        aria-label="Cerrar"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 p-2 text-white/80"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div className="z-10 flex flex-1 flex-col justify-center">
        <h1 className="mb-16 text-center text-6xl font-bold tracking-tight text-white">Dealr</h1>

        {!linkSent && !showEmailForm ? (
          <div className="space-y-8">
            <button type="button" onClick={googleSignIn} disabled={busy} className="btn-primary flex items-center justify-center gap-3">
              <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C40.971 35.205 44 30 44 24c0-1.341-.138-2.65-.389-3.917z" />
              </svg>
              {busy ? 'Conectando…' : 'Continuar con Google'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEmailForm(true)
                setError('')
                setRawError('')
              }}
              className="w-full text-center text-sm font-medium text-white drop-shadow"
            >
              Usar mi email
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full text-center text-sm text-white/70"
            >
              Ver artículos sin cuenta
            </button>
          </div>
        ) : !linkSent ? (
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
            <button
              type="button"
              onClick={() => {
                setShowEmailForm(false)
                setChannel('email')
                setError('')
                setRawError('')
              }}
              className="w-full text-center text-sm text-neutral-500"
            >
              Volver
            </button>
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

      <p className="z-10 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-neutral-500">
        Al continuar aceptás nuestros Términos y la Política de privacidad
      </p>
    </div>
  )
}
