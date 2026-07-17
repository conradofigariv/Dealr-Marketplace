import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': el SW nuevo espera a que el usuario toque "Actualizar"
      // (UpdatePrompt). Antes con 'autoUpdate' el build viejo seguía hasta
      // cerrar todas las pestañas — la causa #1 de "deployé y no veo cambios".
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-512-maskable.png'],
      manifest: {
        name: 'Dealr — Marketplace de usados',
        short_name: 'Dealr',
        description: 'Comprá y vendé usados en Córdoba con confianza',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Variante "maskable" aparte: el martillo va más chico y centrado
          // (safe zone) para que la máscara circular/squircle de Android no
          // se lo coma en los bordes — la "any" de arriba usa el tamaño
          // completo porque ahí no hay recorte.
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        // Sumamos audio al precache (el default no incluye mp3): los sonidos de
        // public/sounds/ quedan disponibles offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,mp3,ogg,m4a,wav}'],
        // Inyecta los handlers de Web Push (push + notificationclick) en el SW
        // generado, sin tener que escribir un SW propio (injectManifest).
        importScripts: ['push-listener.js'],
        // Caché de imágenes en runtime: las fotos (Supabase Storage) y los tiles
        // del mapa se guardan tras la 1ª carga → no se vuelven a descargar
        // (ahorra datos) y aparecen al instante. Los paths de Storage son únicos
        // e inmutables, así que CacheFirst es seguro (nunca sirve algo viejo).
        runtimeCaching: [
          {
            urlPattern: /\/storage\/v1\/object\/public\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dealr-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /basemaps\.cartocdn\.com|cartodb-basemaps/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dealr-map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
