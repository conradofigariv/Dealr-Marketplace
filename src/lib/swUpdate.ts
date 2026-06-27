// Puente para chequear actualizaciones del service worker desde cualquier lado
// (ej. el botón "Chequear actualización" en Ajustes). UpdatePrompt registra acá
// la ServiceWorkerRegistration cuando el SW queda listo; si después aparece una
// versión nueva, el propio UpdatePrompt muestra el aviso para actualizar.
let reg: ServiceWorkerRegistration | null = null

export function setSwRegistration(r: ServiceWorkerRegistration) {
  reg = r
}

// Fuerza un chequeo de versión nueva. Devuelve:
//   true  → hay una versión nueva (quedó instalándose/esperando); UpdatePrompt
//           va a mostrar el aviso "Hay una versión nueva".
//   false → ya estás en la última versión.
//   null  → el service worker todavía no está listo (o no hay SW, ej. en dev).
export async function checkForUpdate(): Promise<boolean | null> {
  if (!reg) return null
  try {
    await reg.update()
  } catch {
    return null
  }
  return !!(reg.installing || reg.waiting)
}
