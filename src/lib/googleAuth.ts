// Login con Google sin pasar por el dominio de Supabase: usa Google Identity
// Services (GIS) directo — el consentimiento muestra "Dealr" y el dominio de
// Vercel, nunca xxxx.supabase.co. El botón nativo de Google entrega un ID
// token (JWT) que se canjea con supabase.auth.signInWithIdToken(), sin
// redirect de página completa.
//
// Requiere VITE_GOOGLE_CLIENT_ID (mismo Client ID que ya está cargado en
// Supabase → Auth → Google, agregado ADEMÁS a "Authorized Client IDs" ahí).
// Sin esa variable, este módulo no hace nada y Auth.tsx cae al flujo viejo
// (signInWithOAuth con redirect) — no rompe nada durante el rollout.

export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            nonce?: string
            use_fedcm_for_prompt?: boolean
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              type: 'standard'
              theme: 'outline' | 'filled_black' | 'filled_blue'
              size: 'large' | 'medium' | 'small'
              shape: 'pill' | 'rectangular'
              text: 'continue_with' | 'signin_with'
              logo_alignment: 'left' | 'center'
              width?: number
            },
          ) => void
        }
      }
    }
  }
}

// Supabase tiene "Skip nonce checks" desactivado (correcto: sin eso, cualquier
// ID token robado de OTRO sitio que use el mismo Client ID serviría para
// entrar). Con el check activo, hay que mandar un nonce de un solo uso: el
// HASH va a Google (queda grabado en el ID token) y el valor CRUDO se le pasa
// a Supabase, que lo hashea de nuevo y compara — así prueba que el token es
// de ESTE intento de login, no uno reciclado. Es el patrón oficial de
// Supabase para Google Identity Services en web.
function generateNonce(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

let scriptPromise: Promise<void> | null = null

// Inyecta el script de GIS una sola vez (cacheado a nivel de módulo). Se
// resuelve cuando window.google.accounts.id queda disponible, o rechaza si
// tarda más de 4s (red bloqueada, ad-blocker, etc.) — Auth.tsx usa el
// rechazo para caer al flujo de redirect de siempre.
function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    const timeout = setTimeout(() => reject(new Error('timeout')), 4000)
    script.onload = () => {
      clearTimeout(timeout)
      if (window.google?.accounts?.id) resolve()
      else reject(new Error('GIS cargó pero google.accounts.id no está'))
    }
    script.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('No se pudo cargar el script de Google'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

// Carga GIS y dibuja el botón nativo de Google dentro de `container`. Llama
// a `onCredential` con el ID token (JWT) y el nonce crudo (pasarlo tal cual a
// supabase.auth.signInWithIdToken({..., nonce})) cuando el usuario elige una
// cuenta. Devuelve una promesa que rechaza si algo falla (Auth.tsx cae al
// fallback).
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (idToken: string, nonce: string) => void,
): Promise<void> {
  if (!googleClientId) throw new Error('VITE_GOOGLE_CLIENT_ID no configurado')
  await loadGoogleScript()
  const google = window.google
  if (!google) throw new Error('google no disponible tras cargar el script')
  const nonce = generateNonce()
  const hashedNonce = await sha256Hex(nonce)
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: (response) => onCredential(response.credential, nonce),
    nonce: hashedNonce,
    use_fedcm_for_prompt: true,
  })
  const width = Math.min(400, Math.max(200, container.offsetWidth || 320))
  // theme "outline" = fondo blanco: combina con el resto de los botones
  // primarios de Dealr (btn-primary también es blanco/pill).
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    logo_alignment: 'left',
    width,
  })
}
