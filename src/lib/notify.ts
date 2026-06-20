// Alertas al usuario cuando llega una notificación: sonido (Web Audio, sin
// archivo), vibración y notificación del navegador (cuando la pestaña está en
// segundo plano). El push real (app cerrada) vive en push.ts + el SW.

const SOUND_KEY = 'dealr_sound' // 'on' | 'off' (default 'on')

export function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'off'
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
}

// --- Sonido sintetizado (no necesita asset) -------------------------------
// El AudioContext arranca "suspendido" hasta un gesto del usuario (política de
// autoplay). Lo resucitamos en la primera interacción para que el primer chime
// suene sí o sí.
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  return ctx
}

// Desbloqueo del audio al primer toque/click/tecla.
if (typeof window !== 'undefined') {
  const unlock = () => {
    getCtx()?.resume()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

// Chime corto de dos notas (sol5 → si5), suave, con fade de salida.
export function playChime() {
  if (!soundEnabled()) return
  const ac = getCtx()
  if (!ac) return
  if (ac.state === 'suspended') ac.resume()
  const now = ac.currentTime
  const notes = [784, 988] // G5, B5
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = now + i * 0.12
    const end = start + 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain).connect(ac.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  })
}

export function vibrate(pattern: number | number[] = [40, 30, 40]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      /* algunos navegadores lo bloquean sin gesto; lo ignoramos */
    }
  }
}

// --- Permiso + notificación del navegador ---------------------------------
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

// Muestra una notificación del sistema. Preferimos la del Service Worker
// (mejor soporte en mobile y permite click → abrir la app); si no hay SW
// activo, caemos a la Notification clásica.
async function showSystemNotification(title: string, body: string | null, link: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const opts: NotificationOptions = {
    body: body ?? undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: link ?? '/' },
    tag: link ?? undefined, // agrupa por destino (no spamea N globos del mismo chat)
  }
  try {
    const reg = (await navigator.serviceWorker?.getRegistration?.()) ?? null
    if (reg) {
      await reg.showNotification(title, opts)
      return
    }
  } catch {
    /* cae al fallback */
  }
  try {
    const n = new Notification(title, opts)
    n.onclick = () => {
      window.focus()
      window.location.href = link ?? '/'
    }
  } catch {
    /* sin permiso o no soportado */
  }
}

// Punto único que llama el provider cuando entra una notificación por realtime.
// Sonido + vibración siempre; globo del navegador solo si la pestaña no está
// visible (si la estás mirando, ya ves el badge/centro).
export function alertIncoming(title: string, body: string | null, link: string | null) {
  playChime()
  vibrate()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    showSystemNotification(title, body, link)
  }
}
