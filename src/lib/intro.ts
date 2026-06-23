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
