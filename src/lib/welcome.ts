// Marca si el usuario ya vio la pantalla de bienvenida/login al menos una
// vez. La primera apertura de la app la muestra; después va directo al feed.
const KEY = 'dealr-welcomed'

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true // sin storage (modo privado): no insistir con la bienvenida
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* ignore */
  }
}
