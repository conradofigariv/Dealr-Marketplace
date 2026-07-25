import { useEffect, useState } from 'react'
import {
  isInAppBrowser,
  inAppBrowserName,
  openInExternalBrowser,
  canAutoEscape,
  isUndetectableIphone,
} from '../lib/inAppBrowser'
import { useToast } from './Toast'

// Una vez por dispositivo para la variante "quizás" (iPhone indetectable).
const SOFT_SEEN_KEY = 'dealr_soft_browser_tip'

// Pasos según el teléfono para salir al navegador real. Android puede escapar
// solo (botón); iPhone no, así que los pasos son la guía principal.
function browserSteps(auto: boolean, known: boolean): string[] {
  if (auto) {
    // Android
    return ['Tocá el menú (⋮) arriba a la derecha', 'Elegí "Abrir en Chrome" o "Abrir en el navegador"']
  }
  if (known) {
    // iPhone en Facebook/Instagram (sabemos el nombre exacto de la opción)
    return ['Tocá ⋯ arriba a la derecha', 'Elegí "Abrir en navegador externo"']
  }
  // iPhone en otra app (Reddit, Telegram…): guía genérica
  return ['Tocá el ícono 🧭 o el menú (⋯)', 'Elegí "Abrir en el navegador"']
}

// Cartel que invita a abrir Dealr en el navegador real del celu (donde el
// login es fácil, Google funciona y se puede instalar la PWA). Mensaje único
// para todos los casos + pasos que se adaptan al teléfono. Dos formas de
// entrar:
// - `detected`: sabemos que es un WebView embebido (FB/IG/Android/iOS sin
//   Safari) → cartel siempre; descartable solo en Home (compact).
// - "quizás": iPhone donde no podemos saber si es WebView (Reddit copia el UA
//   de Safari) → solo en Home, UNA vez por dispositivo.
export default function InAppBrowserBanner({ compact = false }: { compact?: boolean }) {
  const toast = useToast()
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('dealr_iab_dismissed') === '1')
  const [hidden, setHidden] = useState(false)

  const detected = isInAppBrowser()
  const maybe =
    !detected && compact && isUndetectableIphone() && localStorage.getItem(SOFT_SEEN_KEY) !== '1'

  // La variante "quizás" se marca vista al renderizarse: una única vez por
  // dispositivo, aunque no la toquen.
  useEffect(() => {
    if (maybe) localStorage.setItem(SOFT_SEEN_KEY, '1')
  }, [maybe])

  if (hidden) return null
  if (!detected && !maybe) return null
  if (detected && compact && dismissed) return null

  const auto = canAutoEscape()
  const known = inAppBrowserName() !== 'la app'
  const steps = browserSteps(auto, known)
  const canDismiss = compact // Home: descartable; Auth: fijo

  function copyLink() {
    navigator.clipboard
      ?.writeText(window.location.origin)
      .then(() => toast('Link copiado — pegalo en tu navegador (Safari/Chrome)'))
      .catch(() => toast('Copiá el link de arriba y pegalo en tu navegador'))
  }

  function dismiss() {
    if (maybe) {
      setHidden(true) // ya quedó marcada como vista
      return
    }
    sessionStorage.setItem('dealr_iab_dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="mx-4 mb-2 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl leading-none">🧭</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug text-amber-100">
            Para que Dealr funcione mejor, utilizalo en el navegador de tu celu!
          </p>

          {/* Pasos numerados según el teléfono */}
          <ol className="mt-2.5 space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-amber-200/90">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-[10px] font-bold text-amber-300">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          {/* Bonus: instalar la PWA (se hace desde el navegador real). */}
          <p className="mt-2.5 text-xs leading-snug text-amber-200/70">
            📲 Ya en el navegador, podés instalar Dealr en tu pantalla de inicio, como una app.
          </p>

          <div className="mt-3 flex items-center gap-2">
            {auto ? (
              <button
                onClick={openInExternalBrowser}
                className="rounded-full bg-amber-400 px-4 py-2 text-[13px] font-bold text-black transition active:scale-95"
              >
                Abrir en el navegador
              </button>
            ) : (
              <button
                onClick={copyLink}
                className="rounded-full bg-amber-400 px-4 py-2 text-[13px] font-bold text-black transition active:scale-95"
              >
                Copiar link
              </button>
            )}
            {canDismiss && (
              <button onClick={dismiss} className="rounded-full px-3 py-2 text-xs font-medium text-amber-200/60">
                Ahora no
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
