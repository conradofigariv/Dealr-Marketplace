// Marca si el usuario ya vio el onboarding de funciones (3 slides) que se
// muestra una vez, después de iniciar sesión. Igual que welcome.ts, con
// respaldo en memoria por si localStorage está bloqueado.
const KEY = 'dealr-intro-seen'

let seenInMemory = false

export function hasSeenIntro(): boolean {
  if (seenInMemory) return true
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markIntroSeen() {
  seenInMemory = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* ignore: queda la marca en memoria */
  }
}

// Vuelve a mostrar el onboarding de funciones (para moderadores: previsualizar
// la experiencia de un usuario nuevo). Limpia el flag y avisa a App con un
// evento para mostrarlo sin recargar.
export const REPLAY_INTRO_EVENT = 'dealr:replay-intro'

export function replayIntro() {
  seenInMemory = false
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REPLAY_INTRO_EVENT))
}

// Precarga las fotos del onboarding al caché del navegador (una sola vez por
// sesión). Se llama desde Auth: mientras el usuario inicia sesión, las imágenes
// quedan listas y los slides post-login aparecen al instante. Si ya vio el
// intro, no hace nada.
let preloaded = false

export function preloadOnboardingImages(urls: string[]) {
  if (preloaded || typeof window === 'undefined' || hasSeenIntro()) return
  preloaded = true
  for (const url of urls) {
    const img = new Image()
    img.src = url
  }
}
