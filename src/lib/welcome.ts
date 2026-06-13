// Marca si el usuario ya vio la pantalla de bienvenida/login al menos una
// vez. La primera apertura de la app la muestra; después va directo al feed.
const KEY = 'dealr-welcomed'

// Respaldo en memoria: si localStorage está bloqueado (Safari privado), la
// marca persiste igual durante la sesión y evita que el cierre del login
// rebote de vuelta a la bienvenida en un bucle.
let seenInMemory = false

export function hasSeenWelcome(): boolean {
  if (seenInMemory) return true
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markWelcomeSeen() {
  seenInMemory = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* ignore: queda la marca en memoria */
  }
}
