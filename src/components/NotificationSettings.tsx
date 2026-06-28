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
import { pushSupported, subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '../lib/push'
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
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const supported = pushSupported()

  // El toggle refleja el estado REAL de la suscripción del dispositivo (no
  // asumimos: la consultamos al montar).
  useEffect(() => {
    isPushSubscribed().then(setPushOn)
  }, [])

  // Activa/desactiva el push de verdad: al prender pide permiso (si hace falta)
  // y se suscribe; al apagar, se desuscribe. Así el toggle no queda "pegado".
  async function togglePush() {
    if (pushBusy) return
    setPushBusy(true)
    try {
      if (!pushOn) {
        let p = notificationPermission()
        if (p === 'default') p = await requestNotificationPermission()
        setPerm(p)
        if (p !== 'granted') {
          toast(p === 'denied'
            ? 'Bloqueadas. Activalas en los ajustes del sistema/navegador.'
            : 'No se pudo pedir el permiso.')
          return
        }
        const ok = await subscribeToPush()
        if (ok) {
          setPushOn(true)
          playChime()
          toast('Notificaciones push activadas')
        } else {
          toast('No se pudo activar el push en este dispositivo.')
        }
      } else {
        await unsubscribeFromPush()
        setPushOn(false)
        toast('Notificaciones push desactivadas')
      }
    } finally {
      setPushBusy(false)
    }
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
      {/* Notificaciones push: toggle real (suscribe / desuscribe el dispositivo) */}
      {!supported ? (
        <div className="rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
          <p className="text-neutral-300">Notificaciones push</p>
          <p className="mt-0.5 text-xs text-neutral-600">Tu navegador no las soporta.</p>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800">
          <div className="min-w-0 pr-3">
            <p className="text-neutral-300">Notificaciones push</p>
            {perm === 'denied' && (
              <p className="mt-0.5 text-xs text-neutral-600">Bloqueadas — activalas en los ajustes del navegador</p>
            )}
          </div>
          {pushBusy ? (
            <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          ) : (
            <Toggle on={pushOn} onChange={togglePush} label="Notificaciones push" />
          )}
        </div>
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
    </div>
  )
}
