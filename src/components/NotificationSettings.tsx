import { useEffect, useState } from 'react'
import {
  notificationPermission,
  requestNotificationPermission,
  soundEnabled,
  setSoundEnabled,
  hapticsEnabled,
  setHapticsEnabled,
  playChime,
  haptic,
} from '../lib/notify'
import { pushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { useToast } from './Toast'

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-white' : 'bg-neutral-700'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition ${on ? 'left-[1.375rem]' : 'left-0.5'}`}
      />
    </button>
  )
}

export default function NotificationSettings() {
  const toast = useToast()
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(notificationPermission())
  const [sound, setSound] = useState(soundEnabled())
  const [haptics, setHaptics] = useState(hapticsEnabled())
  const [working, setWorking] = useState(false)

  // Si el permiso ya está dado, intentamos asegurar la suscripción a push.
  useEffect(() => {
    if (perm === 'granted' && pushSupported()) subscribeToPush()
  }, [perm])

  async function enable() {
    setWorking(true)
    const result = await requestNotificationPermission()
    setPerm(result)
    if (result === 'granted') {
      if (pushSupported()) await subscribeToPush()
      playChime()
      toast('Notificaciones activadas')
    } else if (result === 'denied') {
      toast('Bloqueadas. Activalas desde los ajustes del navegador.')
    }
    setWorking(false)
  }

  function toggleSound() {
    const next = !sound
    setSound(next)
    setSoundEnabled(next)
    if (next) playChime()
  }

  function toggleHaptics() {
    const next = !haptics
    setHaptics(next)
    setHapticsEnabled(next)
    if (next) haptic('success') // hay que setear el valor antes de vibrar
  }

  return (
    <div className="space-y-2">
      {/* Permiso del sistema / push */}
      {perm === 'unsupported' ? (
        <div className="rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
          <p className="text-neutral-300">Notificaciones</p>
          <p className="mt-0.5 text-xs text-neutral-600">Tu navegador no las soporta.</p>
        </div>
      ) : perm === 'granted' ? (
        <div className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
          <div>
            <p className="text-neutral-300">Notificaciones</p>
            <p className="mt-0.5 text-xs text-emerald-400">Activadas</p>
          </div>
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
      ) : (
        <button
          onClick={enable}
          disabled={working}
          className="flex w-full items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 text-left ring-1 ring-neutral-800 transition hover:ring-neutral-700 disabled:opacity-60"
        >
          <div>
            <p className="text-neutral-300">Notificaciones</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              {perm === 'denied' ? 'Bloqueadas — activalas en el navegador' : 'Tocá para activar avisos y push'}
            </p>
          </div>
          {perm !== 'denied' && <span className="text-xs font-semibold text-white">Activar</span>}
        </button>
      )}

      {/* Sonido */}
      <div className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
        <span className="text-neutral-300">Sonido</span>
        <Toggle on={sound} onChange={toggleSound} label="Sonido de notificaciones" />
      </div>

      {/* Vibración */}
      <div className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
        <span className="text-neutral-300">Vibración</span>
        <Toggle on={haptics} onChange={toggleHaptics} label="Vibración háptica" />
      </div>

      {perm === 'granted' && pushSupported() && (
        <button
          onClick={async () => {
            await unsubscribeFromPush()
            toast('Push desactivado en este dispositivo')
          }}
          className="px-1 text-left text-xs text-neutral-600 underline-offset-2 hover:underline"
        >
          Desactivar push en este dispositivo
        </button>
      )}
    </div>
  )
}
