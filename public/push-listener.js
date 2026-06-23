// Handlers de Web Push, importados por el SW generado de Workbox
// (vite.config → workbox.importScripts). Recibe el push de la Edge Function
// `send-push` y muestra el globo; al tocarlo, abre/enfoca la app en el link.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'Dealr', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Dealr'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
    tag: data.tag || data.link || undefined,
    renotify: Boolean(data.tag || data.link),
  }
  event.waitUntil(self.registration.showNotification(title, options))

  // Badge: mostrar que hay notificaciones sin leer
  if ('setAppBadge' in navigator) navigator.setAppBadge(1)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'

  // Badge: limpiar cuando el usuario abre la notificación
  if ('clearAppBadge' in navigator) navigator.clearAppBadge()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Si ya hay una pestaña abierta, la enfocamos y navegamos.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(link)
          return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    }),
  )
})
