import { useEffect, useState } from 'react'
import { getInstallPrompt, promptInstall, onInstallChange, isStandalone, isIOS } from '../lib/pwaInstall'

// Botón "Agregar a inicio". En Android/desktop Chrome dispara el instalador
// nativo. En iOS no se puede por código: muestra el instructivo (Compartir →
// Agregar a inicio, solo desde Safari). Si ya está instalada, no renderiza nada.
export default function InstallButton() {
  const [canPrompt, setCanPrompt] = useState(Boolean(getInstallPrompt()))
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => onInstallChange(() => setCanPrompt(Boolean(getInstallPrompt()))), [])

  if (isStandalone()) return null

  const ios = isIOS()
  // Sin prompt nativo y sin ser iOS no hay nada que ofrecer (ej. ya instalada
  // en desktop, o navegador no soportado).
  if (!canPrompt && !ios) return null

  const Icon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  )

  if (ios) {
    return (
      <div className="rounded-2xl bg-neutral-900 ring-1 ring-neutral-800">
        <button
          onClick={() => setShowIosHint((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3.5"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-white">
            {Icon}
            Agregar a la pantalla de inicio
          </span>
          <svg viewBox="0 0 24 24" className={`h-5 w-5 text-neutral-500 transition ${showIosHint ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        {showIosHint && (
          <div className="border-t border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
            En iPhone, desde <strong className="text-white">Safari</strong>: tocá el botón{' '}
            <strong className="text-white">Compartir</strong>{' '}
            <svg viewBox="0 0 24 24" className="inline h-3.5 w-3.5 -translate-y-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <path d="M16 6l-4-4-4 4M12 2v14" />
            </svg>{' '}
            y elegí <strong className="text-white">Agregar a inicio</strong>.
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => promptInstall()}
      className="flex w-full items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800 transition hover:ring-neutral-700"
    >
      <span className="flex items-center gap-2.5 text-sm font-medium text-white">
        {Icon}
        Instalar Dealr
      </span>
      <span className="text-xs font-semibold text-white">Instalar</span>
    </button>
  )
}
