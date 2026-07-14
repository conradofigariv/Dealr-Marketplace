import { useState } from 'react'
import { isInAppBrowser, inAppBrowserName, openInExternalBrowser } from '../lib/inAppBrowser'
import { useToast } from './Toast'

// Banner "estás en el navegador de Facebook/Instagram": invita a abrir Dealr
// en el navegador real, donde el login es fácil (contraseñas guardadas,
// Google funciona) y se puede instalar la app. En Android el botón escapa
// solo (intent://); en iPhone no hay escape programático → guía al menú ⋯ y
// ofrece copiar el link.
export default function InAppBrowserBanner({ compact = false }: { compact?: boolean }) {
  const toast = useToast()
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('dealr_iab_dismissed') === '1',
  )
  if (!isInAppBrowser() || (compact && dismissed)) return null

  const appName = inAppBrowserName()

  function escape() {
    if (openInExternalBrowser()) return
    // iOS: no se puede forzar; copiamos el link y explicamos el camino.
    navigator.clipboard
      ?.writeText(window.location.origin)
      .then(() => toast('Link copiado — pegalo en Safari o Chrome'))
      .catch(() => toast('Tocá ⋯ arriba y elegí "Abrir en el navegador"'))
  }

  function dismiss() {
    sessionStorage.setItem('dealr_iab_dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="mx-4 mb-2 rounded-2xl bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg leading-none">🧭</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-amber-200">
            Estás en el navegador de {appName}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-amber-200/70">
            Para entrar más fácil (y poder instalar la app), abrí Dealr en tu navegador: tocá{' '}
            <strong className="text-amber-200">⋯</strong> arriba y elegí{' '}
            <strong className="text-amber-200">"Abrir en el navegador"</strong>.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={escape}
              className="rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-black transition active:scale-95"
            >
              Abrir en el navegador
            </button>
            {compact && (
              <button
                onClick={dismiss}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-amber-200/60"
              >
                Ahora no
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
