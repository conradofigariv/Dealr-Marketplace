import { useEffect, useState } from 'react'
import {
  isInAppBrowser,
  inAppBrowserName,
  openInExternalBrowser,
  canAutoEscape,
  isUndetectableIphone,
} from '../lib/inAppBrowser'
import { useToast } from './Toast'

// Una vez por dispositivo para la variante suave (iPhone indetectable).
const SOFT_SEEN_KEY = 'dealr_soft_browser_tip'

// Banner "estás en el navegador de Facebook/Instagram": invita a abrir Dealr
// en el navegador real, donde el login es fácil (contraseñas guardadas,
// Google funciona) y se puede instalar la app. Dos variantes por dispositivo:
// - Android: botón "Abrir en el navegador" que escapa solo (intent://).
// - iPhone: no hay escape programático → la instrucción del menú ⋯ ES el
//   mensaje principal (texto grande, con el nombre literal de la opción de
//   FB: "Abrir en navegador externo") y el botón dice lo que hace de verdad:
//   "Copiar link".
export default function InAppBrowserBanner({ compact = false }: { compact?: boolean }) {
  const toast = useToast()
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('dealr_iab_dismissed') === '1',
  )
  const detected = isInAppBrowser()
  // Variante SUAVE: iPhone donde no podemos saber si es WebView (Reddit copia
  // el UA de Safari entero). Solo en Home (compact) y UNA vez por dispositivo.
  const soft =
    !detected &&
    compact &&
    isUndetectableIphone() &&
    localStorage.getItem(SOFT_SEEN_KEY) !== '1'
  const [softVisible, setSoftVisible] = useState(true)

  // La variante suave se marca vista al renderizarse: literalmente una única
  // vez por dispositivo, aunque no la toquen.
  useEffect(() => {
    if (soft) localStorage.setItem(SOFT_SEEN_KEY, '1')
  }, [soft])

  if (soft && softVisible) {
    return (
      <div className="mx-4 mb-2 rounded-2xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg leading-none">💡</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-white">
              ¿Abriste este link desde otra app?
            </p>
            <p className="mt-0.5 text-xs leading-snug text-neutral-400">
              Desde Reddit, Telegram y similares conviene abrir Dealr en Safari o Chrome: entrás
              más fácil y podés instalar la app. Buscá{' '}
              <strong className="text-neutral-200">"Abrir en el navegador"</strong> (suele ser 🧭 o
              el menú ⋯).
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(window.location.origin)
                    .then(() => toast('Link copiado — pegalo en Safari o Chrome'))
                    .catch(() => {})
                }}
                className="rounded-full bg-white px-4 py-2 text-[13px] font-bold text-black transition active:scale-95"
              >
                Copiar link
              </button>
              <button
                onClick={() => setSoftVisible(false)}
                className="rounded-full px-3 py-2 text-xs font-medium text-neutral-500"
              >
                Ya estoy en mi navegador
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!detected || (compact && dismissed)) return null

  const appName = inAppBrowserName()
  const auto = canAutoEscape()
  // App desconocida (ej. Reddit, que copia el UA de Safari): no sabemos cómo
  // se llama su opción ni dónde está el menú → instrucción genérica.
  const known = appName !== 'la app'

  function copyLink() {
    navigator.clipboard
      ?.writeText(window.location.origin)
      .then(() => toast('Link copiado — pegalo en Safari o Chrome'))
      .catch(() => toast('No se pudo copiar. Usá el menú ⋯ de arriba'))
  }

  function dismiss() {
    sessionStorage.setItem('dealr_iab_dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="mx-4 mb-2 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg leading-none">🧭</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-amber-200">
            {known ? `Estás en el navegador de ${appName}` : 'Estás en el navegador de otra app'}
          </p>
          {auto ? (
            <>
              <p className="mt-0.5 text-xs leading-snug text-amber-200/70">
                Para entrar más fácil (y poder instalar la app), abrila en tu navegador.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={openInExternalBrowser}
                  className="rounded-full bg-amber-400 px-4 py-2 text-[13px] font-bold text-black transition active:scale-95"
                >
                  Abrir en el navegador
                </button>
                {compact && (
                  <button
                    onClick={dismiss}
                    className="rounded-full px-3 py-2 text-xs font-medium text-amber-200/60"
                  >
                    Ahora no
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* iPhone: la instrucción es el mensaje principal, no letra chica. */}
              {known ? (
                <p className="mt-1.5 text-[15px] font-medium leading-snug text-amber-100">
                  Tocá <span className="mx-0.5 inline-flex h-6 w-8 items-center justify-center rounded-md bg-amber-400/20 align-middle text-base font-bold tracking-widest">⋯</span> arriba a la derecha y elegí{' '}
                  <span className="whitespace-nowrap">"Abrir en navegador externo"</span>
                </p>
              ) : (
                <p className="mt-1.5 text-[15px] font-medium leading-snug text-amber-100">
                  Buscá la opción <span className="whitespace-nowrap">"Abrir en el navegador"</span> (suele ser 🧭 o el menú ⋯)
                </p>
              )}
              <p className="mt-1 text-xs leading-snug text-amber-200/70">
                Así entrás más fácil y podés instalar la app.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="rounded-full bg-amber-400/15 px-4 py-2 text-[13px] font-bold text-amber-200 ring-1 ring-amber-400/40 transition active:scale-95"
                >
                  Copiar link
                </button>
                {compact && (
                  <button
                    onClick={dismiss}
                    className="rounded-full px-3 py-2 text-xs font-medium text-amber-200/60"
                  >
                    Ahora no
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
