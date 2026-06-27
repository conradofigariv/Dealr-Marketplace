// Alertas al usuario cuando llega una notificación: sonido (Web Audio, sin
// archivo), vibración y notificación del navegador (cuando la pestaña está en
// segundo plano). El push real (app cerrada) vive en push.ts + el SW.

const SOUND_KEY = 'dealr_sound' // 'on' | 'off' (default 'on')
const HAPTICS_KEY = 'dealr_haptics' // 'on' | 'off' (default 'on')

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    /* ignorar */
  }
}

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    localStorage.setItem(HAPTICS_KEY, on ? 'on' : 'off')
  } catch {
    /* ignorar */
  }
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

// Reproductor genérico: una secuencia de notas sinusoidales con fade de salida.
// Cada nota = { freq, at (offset en s), dur, gain }. No necesita ningún asset.
interface Note {
  freq: number
  at: number
  dur: number
  gain?: number
  type?: OscillatorType
}

function playNotes(notes: Note[]) {
  if (!soundEnabled()) return
  const ac = getCtx()
  if (!ac) return
  if (ac.state === 'suspended') ac.resume()
  const now = ac.currentTime
  for (const n of notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.value = n.freq
    const start = now + n.at
    const end = start + n.dur
    const peak = n.gain ?? 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peak, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain).connect(ac.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

// Paleta de sonidos con nombre (todos sintetizados).
const SOUNDS: Record<string, Note[]> = {
  // Chime corto de dos notas (sol5 → si5): el de las notificaciones.
  chime: [
    { freq: 784, at: 0, dur: 0.18 },
    { freq: 988, at: 0.12, dur: 0.18 },
  ],
  // Acorde ascendente alegre: publicar con éxito, acción confirmada.
  success: [
    { freq: 523, at: 0, dur: 0.16 }, // C5
    { freq: 659, at: 0.09, dur: 0.16 }, // E5
    { freq: 784, at: 0.18, dur: 0.22 }, // G5
  ],
  // Blip corto: puja registrada / tap positivo.
  pop: [{ freq: 660, at: 0, dur: 0.12, gain: 0.16 }],
  // Descendente "uh-oh": te superaron la oferta.
  outbid: [
    { freq: 659, at: 0, dur: 0.14 }, // E5
    { freq: 523, at: 0.1, dur: 0.14 }, // C5
    { freq: 440, at: 0.2, dur: 0.2 }, // A4
  ],
  // Fanfarria: ganaste la subasta.
  win: [
    { freq: 523, at: 0, dur: 0.14 }, // C5
    { freq: 659, at: 0.12, dur: 0.14 }, // E5
    { freq: 784, at: 0.24, dur: 0.14 }, // G5
    { freq: 1047, at: 0.36, dur: 0.3 }, // C6
  ],
  // Clic muy corto y agudo: tick del countdown.
  tick: [{ freq: 1200, at: 0, dur: 0.04, gain: 0.1 }],
}

export type SoundKind = keyof typeof SOUNDS

export function playSound(kind: SoundKind) {
  playNotes(SOUNDS[kind])
}

// Alias histórico (lo usan NotificationSettings y alertIncoming).
export function playChime() {
  playSound('chime')
}

// Vibración cruda, respetando el toggle de hápticos del usuario.
export function vibrate(pattern: number | number[] = [40, 30, 40]) {
  if (!hapticsEnabled()) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      /* algunos navegadores lo bloquean sin gesto; lo ignoramos */
    }
  }
}

// Patrones hápticos con nombre, para no esparcir números mágicos por el código.
const HAPTICS: Record<string, number | number[]> = {
  tap: 12, // toque mínimo (long-press, favoritear)
  tick: 8, // casi imperceptible (countdown)
  success: [25, 30, 25, 30, 50], // confirmación alegre
  heavy: 60, // golpe firme (te superaron, ganaste)
  error: [40, 60, 40], // algo salió mal
  heartbeat: [18, 80, 28], // lub-dub para los últimos segundos
}

export type HapticKind = keyof typeof HAPTICS

export function haptic(kind: HapticKind) {
  vibrate(HAPTICS[kind])
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
