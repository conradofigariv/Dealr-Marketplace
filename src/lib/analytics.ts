import type posthogType from 'posthog-js'

// Product analytics con PostHog. Si no hay VITE_POSTHOG_KEY (dev, previews),
// todo queda en no-op. posthog-js se carga de forma diferida (import dinámico)
// para no pesar en el bundle inicial; los eventos disparados antes de que
// termine de cargar se encolan y se reproducen al estar listo.
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com'

export const analyticsEnabled = Boolean(key)

let ph: typeof posthogType | null = null
const queue: ((p: typeof posthogType) => void)[] = []

function withPH(fn: (p: typeof posthogType) => void) {
  if (!key) return
  if (ph) fn(ph)
  else queue.push(fn)
}

export function initAnalytics() {
  if (!key) return
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: host,
      autocapture: true,
      capture_pageview: false, // lo capturamos a mano por ser SPA
      capture_pageleave: true,
      person_profiles: 'identified_only',
    })
    ph = posthog
    queue.forEach((fn) => fn(posthog))
    queue.length = 0
  })
}

export function capture(event: string, props?: Record<string, unknown>) {
  withPH((p) => p.capture(event, props))
}

export function capturePageview(path: string) {
  withPH((p) => p.capture('$pageview', { $current_url: window.location.origin + path }))
}

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  withPH((p) => p.identify(userId, props))
}

export function resetAnalytics() {
  withPH((p) => p.reset())
}
