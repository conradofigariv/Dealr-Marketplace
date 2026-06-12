// Traducción de errores de Supabase Auth a mensajes útiles en español.
const patterns: [RegExp, string][] = [
  [/token has expired|invalid otp|otp_expired/i, 'Código incorrecto o vencido. Pedí uno nuevo.'],
  [/security purposes.*\d+ seconds/i, 'Por seguridad, esperá un minuto antes de pedir otro código.'],
  [/error sending.*email|error sending magic link|error sending confirmation/i, 'No pudimos enviar el mail. El servicio de Supabase tiene un límite muy bajo de envíos por hora — esperá unos minutos y probá de nuevo.'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'],
  [/invalid format|unable to validate email|invalid email/i, 'Ese email no parece válido. Revisalo.'],
  [/invalid phone/i, 'Ese teléfono no parece válido. Usá el formato 351 555 0000.'],
  [/invalid path/i, 'Hay un problema de configuración del servidor (URL de Supabase). Avisale al administrador.'],
  [/provider is not enabled|unsupported provider|validation_failed/i, 'El inicio de sesión con Google todavía no está activado en el servidor.'],
  [/signups not allowed/i, 'El registro está deshabilitado por el momento.'],
  [/database error/i, 'No pudimos crear tu cuenta. Probá de nuevo en un momento.'],
  [/network|fetch/i, 'Problema de conexión. Revisá tu internet y probá de nuevo.'],
]

export function translateAuthError(message: string): string {
  for (const [pattern, translation] of patterns) {
    if (pattern.test(message)) return translation
  }
  return 'Algo salió mal. Probá de nuevo en un momento.'
}
