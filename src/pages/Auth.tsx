import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../lib/authErrors'
import { preloadOnboardingImages } from '../lib/intro'
import Logo from '../components/Logo'
import { ONBOARDING_IMAGES } from '../components/IntroSlides'
import { isInAppBrowser } from '../lib/inAppBrowser'
import InAppBrowserBanner from '../components/InAppBrowserBanner'
import { renderGoogleButton, googleClientId } from '../lib/googleAuth'

type Channel = 'email' | 'phone'

// El login por SMS queda oculto hasta configurar el proveedor (Twilio).
const phoneEnabled = import.meta.env.VITE_ENABLE_PHONE_AUTH === 'true'

const RESEND_SECONDS = 60

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()
  // Dos destinos distintos:
  // - `from`: a dónde ir si SE LOGUEA (la acción que quería hacer, aunque
  //   sea una pantalla que requiere cuenta como Publicar).
  // - `back`: a dónde ir si CANCELA (siempre un lugar navegable sin cuenta,
  //   nunca una pantalla bloqueada, para no rebotar de vuelta al login).
  const navState = location.state as { from?: string; back?: string } | null
  const from = navState?.from ?? '/'
  const back = navState?.back ?? '/'
  const [channel, setChannel] = useState<Channel>('email')
  const [showEmailForm, setShowEmailForm] = useState(false)
  // WebView de FB/IG: sin Google (lo bloquean), el email al frente.
  const inApp = isInAppBrowser()
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState('')
  const [rawError, setRawError] = useState('')
  const [busy, setBusy] = useState(false)
  // Botón nativo de Google (googleAuth.ts): si GIS no carga (red, ad-blocker,
  // VITE_GOOGLE_CLIENT_ID sin configurar) cae al botón viejo con redirect.
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const [gisFailed, setGisFailed] = useState(false)
  const [gisError, setGisError] = useState('')

  // Precarga las fotos del onboarding: mientras el usuario inicia sesión
  // quedan en caché, así los slides post-login aparecen al instante.
  useEffect(() => {
    preloadOnboardingImages(ONBOARDING_IMAGES)
  }, [])

  // Si la sesión aparece (tocó el magic link o login con Google), volver
  // a donde estaba antes de tener que loguearse.
  useEffect(() => {
    if (session) navigate(from, { replace: true })
  }, [session, from, navigate])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  // Fallback: redirect de página completa a través de Supabase (muestra
  // "xxxx.supabase.co" en el consentimiento). Se usa solo si GIS no está
  // configurado o falló al cargar — ver renderGoogleButton más abajo.
  async function googleSignInFallback() {
    setBusy(true)
    setError('')
    setRawError('')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + (from === '/' ? '' : from) },
    })
    if (err) {
      setBusy(false)
      setError(translateAuthError(err.message))
      setRawError(err.message)
    }
    // si no hubo error, el navegador ya está redirigiendo a Google
  }

  // Login con Google sin salir de la página (googleAuth.ts): el botón nativo
  // entrega un ID token que canjeamos con Supabase directo, sin redirect. El
  // consentimiento muestra "Dealr" + el dominio de Vercel, no supabase.co.
  useEffect(() => {
    // Diagnóstico: /auth?debug=google muestra por qué cae (o no) al botón
    // nativo, sin tener que adivinar desde afuera (mismo patrón que
    // ?debug=ua para el in-app browser).
    if (new URLSearchParams(location.search).get('debug') === 'google') {
      window.setTimeout(() => {
        alert(
          `inApp: ${inApp}\nclientId: ${googleClientId ? googleClientId.slice(0, 12) + '…' : '(vacío — falta VITE_GOOGLE_CLIENT_ID)'}\ngisFailed: ${gisFailed}\ngisError: ${gisError || '(ninguno)'}\nwindow.google: ${typeof window.google}`,
        )
      }, 1500)
    }
  }, [inApp, gisFailed, gisError, location.search])

  useEffect(() => {
    if (inApp || !googleClientId || !googleBtnRef.current) return
    let cancelled = false
    renderGoogleButton(googleBtnRef.current, async (idToken, nonce) => {
      setBusy(true)
      setError('')
      setRawError('')
      const { error: err } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce })
      setBusy(false)
      if (err) {
        setError(translateAuthError(err.message))
        setRawError(err.message)
      }
      // si no hubo error, el listener global de sesión navega a `from`.
    }).catch((e) => {
      if (!cancelled) {
        setGisFailed(true)
        setGisError(e instanceof Error ? e.message : String(e))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp])

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
    } else navigate(from, { replace: true })
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col overflow-hidden bg-black px-8">
      {/* Video de fondo: public/login-bg.mp4 (comprimido + faststart para que
          arranque mientras descarga). El poster es su primer cuadro y se ve al
          instante; si el video no existe, queda el fondo negro de siempre. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/login-bg-poster.jpg"
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        src="/login-bg.mp4"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/85" />

      <div className="z-10 flex flex-1 flex-col justify-center">
        <div className="mb-16 flex justify-center">
          <Logo size={60} />
        </div>

        {!linkSent && !showEmailForm ? (
          <div className="space-y-8">
            {/* En el navegador embebido de FB/IG, Google bloquea su OAuth
                (disallowed_useragent): escondemos el botón y empujamos al
                email, que ahí sí funciona. El banner explica cómo escapar. */}
            {inApp && <InAppBrowserBanner />}
            {!inApp && googleClientId && !gisFailed && (
              // Botón NATIVO de Google (googleAuth.ts): dibujado por su propio
              // script dentro de este div. min-h evita el salto de layout
              // mientras GIS termina de cargar y lo completa.
              <div ref={googleBtnRef} className="flex min-h-[52px] w-full items-center justify-center" />
            )}
            {!inApp && (!googleClientId || gisFailed) && (
              <button type="button" onClick={googleSignInFallback} disabled={busy} className="btn-primary flex items-center justify-center gap-3">
                <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0">
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C40.971 35.205 44 30 44 24c0-1.341-.138-2.65-.389-3.917z" />
                </svg>
                {busy ? 'Conectando…' : 'Continuar con Google'}
              </button>
            )}
            {inApp ? (
              <button
                type="button"
                onClick={() => {
                  setShowEmailForm(true)
                  setError('')
                  setRawError('')
                }}
                className="btn-primary flex items-center justify-center gap-2"
              >
                Continuar con mi email
              </button>
            ) : (
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
            )}
            <button
              type="button"
              onClick={() => navigate(back, { replace: true })}
              className="w-full text-center text-sm text-white/70"
            >
              Continuar sin cuenta
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
            {/* El error crudo de Supabase (inglés técnico) solo en desarrollo:
                en la pantalla de login de prod queda poco profesional. */}
            {import.meta.env.DEV && rawError && <p className="mt-1 text-xs text-neutral-600">{rawError}</p>}
          </div>
        )}
      </div>

      <p className="z-10 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-neutral-500">
        Al continuar aceptás nuestros Términos y la Política de privacidad
      </p>
    </div>
  )
}
