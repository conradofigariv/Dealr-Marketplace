import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { setSwRegistration } from '../lib/swUpdate'

// Aviso "hay una versión nueva": aparece cuando el service worker detecta un
// deploy. Tocar "Actualizar" activa el SW nuevo y recarga. Además chequea
// updates cada 60s y al volver al foreground, así no hace falta cerrar todas
// las pestañas para tomar la versión nueva.
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      if (!r) return
      setSwRegistration(r) // para el botón manual "Chequear actualización"
      setInterval(() => r.update(), 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') r.update()
      })
    },
  })
  const [updating, setUpdating] = useState(false)

  if (!needRefresh) return null

  function handleUpdate() {
    setUpdating(true)
    setTimeout(() => updateServiceWorker(true), 3000)
  }

  return (
    <div className="update-prompt-in fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto flex max-w-lg px-4">
      <div className="flex flex-1 items-center justify-between gap-3 rounded-full bg-white px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium text-black">Hay una versión nueva</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="flex items-center gap-1.5 rounded-full bg-black px-3.5 py-1.5 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-80"
          >
            {updating && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {updating ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            onClick={() => setNeedRefresh(false)}
            disabled={updating}
            aria-label="Cerrar"
            className="p-1 text-neutral-500 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
