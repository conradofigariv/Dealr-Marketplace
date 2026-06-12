// Traducción de errores de Supabase Auth a mensajes útiles en español.
const patterns: [RegExp, string][] = [
  [/token has expired|invalid otp|otp_expired/i, 'Código incorrecto o vencido. Pedí uno nuevo.'],
  [/security purposes.*\d+ seconds/i, 'Por seguridad, esperá un minuto antes de pedir otro código.'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'],
  [/invalid format|unable to validate email/i, 'Ese email no parece válido. Revisalo.'],
  [/invalid phone/i, 'Ese teléfono no parece válido. Usá el formato 351 555 0000.'],
  [/signups not allowed/i, 'El registro está deshabilitado por el momento.'],
  [/network|fetch/i, 'Problema de conexión. Revisá tu internet y probá de nuevo.'],
]

export function translateAuthError(message: string): string {
  for (const [pattern, translation] of patterns) {
    if (pattern.test(message)) return translation
  }
  return 'Algo salió mal. Probá de nuevo en un momento.'
}
