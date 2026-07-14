// Detección del navegador embebido (in-app browser / WebView) de Facebook,
// Instagram, Messenger, TikTok, etc. Ahí la conversión muere: no hay
// contraseñas guardadas, Google BLOQUEA su OAuth (error disallowed_useragent)
// y no se puede instalar la PWA. La UI muestra un banner para escapar al
// navegador real y el Auth esconde el botón de Google.

// La PWA instalada corre "standalone" y su UA tampoco dice Safari — NO es un
// WebView de app ajena, hay que excluirla de la heurística genérica.
function isStandalonePWA(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  // Apps conocidas por nombre. FBAN/FBAV/FB_IAB → Facebook y Messenger.
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|musical_ly|TikTok|BytedanceWebview|Reddit/i.test(ua)) {
    return true
  }
  if (isStandalonePWA()) return false
  // Genérico Android: los WebView embebidos llevan "; wv)" en el UA.
  if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return true
  // Genérico iOS: todo navegador real (Safari, Chrome, Firefox, Edge…) declara
  // "Safari/" en el UA; los WebView embebidos de apps no. Cubre las apps que
  // no publican su nombre (Reddit viejo, Telegram, etc.).
  if (/iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) {
    return true
  }
  return false
}

// Nombre de la app contenedora, para el texto del banner.
export function inAppBrowserName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook'
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'TikTok'
  if (/Reddit/i.test(ua)) return 'Reddit'
  if (/Line\//i.test(ua)) return 'Line'
  return 'la app'
}

// En Android el intent:// escapa solo; en iOS no hay escape programático y la
// UI tiene que guiar al menú de la app (⋯ → "Abrir en navegador externo").
export const canAutoEscape = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
const isAndroid = canAutoEscape

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
