// Detección del navegador embebido (in-app browser / WebView) de Facebook,
// Instagram, Messenger, TikTok, etc. Ahí la conversión muere: no hay
// contraseñas guardadas, Google BLOQUEA su OAuth (error disallowed_useragent)
// y no se puede instalar la PWA. La UI muestra un banner para escapar al
// navegador real y el Auth esconde el botón de Google.

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // FBAN/FBAV/FB_IAB → Facebook y Messenger. El resto por nombre.
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|musical_ly|TikTok|BytedanceWebview/i.test(ua)
}

// Nombre de la app contenedora, para el texto del banner.
export function inAppBrowserName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook'
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'TikTok'
  if (/Line\//i.test(ua)) return 'Line'
  return 'la app'
}

const isAndroid = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')

// Intenta abrir la URL actual en el navegador de verdad. En Android los
// intent:// suelen escapar del WebView de FB/IG hacia el navegador default.
// En iOS no existe un escape programático confiable → devuelve false y la UI
// muestra las instrucciones del menú "⋯ → Abrir en el navegador".
export function openInExternalBrowser(): boolean {
  if (!isAndroid()) return false
  const { host, pathname, search } = window.location
  window.location.href = `intent://${host}${pathname}${search}#Intent;scheme=https;end`
  return true
}
