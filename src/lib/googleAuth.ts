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
// a `onCredential` con el ID token (JWT) cuando el usuario elige una cuenta.
// Devuelve una promesa que rechaza si algo falla (Auth.tsx cae al fallback).
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (idToken: string) => void,
): Promise<void> {
  if (!googleClientId) throw new Error('VITE_GOOGLE_CLIENT_ID no configurado')
  await loadGoogleScript()
  const google = window.google
  if (!google) throw new Error('google no disponible tras cargar el script')
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: (response) => onCredential(response.credential),
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
