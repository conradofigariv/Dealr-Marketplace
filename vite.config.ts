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
      includeAssets: ['favicon.svg'],
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
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
      },
    }),
  ],
})
