// Web Push: suscribe al navegador para recibir notificaciones con la app
// CERRADA. El globo lo dispara el SW (public/push-listener.js) cuando llega un
// push desde la Edge Function `send-push`.
//
// Sin VITE_VAPID_PUBLIC_KEY todo queda no-op (igual que analytics sin key), así
// la app no se rompe antes de terminar el setup del backend.

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY)

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    pushConfigured
  )
}

// La applicationServerKey va como Uint8Array (base64url → bytes).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Guarda la suscripción en la DB (RLS limita a la fila del propio usuario).
async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON()
  const keys = json.keys ?? {}
  await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      p256dh: keys.p256dh ?? '',
      auth: keys.auth ?? '',
    },
    { onConflict: 'endpoint' },
  )
}

// Suscribe (o reutiliza la existente) y la persiste. Devuelve true si quedó
// suscripto. Asume que el permiso de Notification ya fue otorgado.
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      })
    }
    await saveSubscription(sub)
    return true
  } catch (err) {
    console.warn('No se pudo suscribir a push:', err)
    return false
  }
}

// ¿Este dispositivo tiene una suscripción de push activa ahora mismo?
// Sirve para que el toggle de Ajustes refleje el estado real (no asumir).
export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return Boolean(sub)
  } catch {
    return false
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch (err) {
    console.warn('No se pudo desuscribir de push:', err)
  }
}
