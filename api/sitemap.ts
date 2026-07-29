// Sitemap dinámico para SEO: sin esto, Google tiene que descubrir cada
// publicación solo por links (lento e incompleto). Se regenera en cada
// pedido (con caché de CDN de 10 min) — no hace falta un build step ni
// tocar nada al publicar/vender.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default async function handler(
  req: { headers: Record<string, string | string[] | undefined> },
  res: {
    setHeader: (k: string, v: string) => void
    status: (c: number) => { send: (b: string) => void }
    send: (b: string) => void
  },
) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'dealr.com.ar')
  const origin = `https://${host}`

  const staticUrls = [
    { loc: origin, changefreq: 'hourly', priority: '1.0' },
    { loc: `${origin}/explorar`, changefreq: 'daily', priority: '0.7' },
  ]

  let listingUrls: { loc: string; lastmod: string }[] = []
  if (supabaseUrl && anonKey) {
    try {
      // Únicas indexables: activas (las pausadas/vendidas/vencidas no tienen
      // valor de búsqueda y confundirían al que llega desde Google). Tope de
      // 5000: muy por debajo del límite de 50k URLs por sitemap.
      const r = await fetch(
        `${supabaseUrl}/rest/v1/listings?status=eq.active&select=id,last_renewed_at&order=last_renewed_at.desc&limit=5000`,
        { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } },
      )
      const rows = (await r.json()) as { id: string; last_renewed_at: string }[]
      if (Array.isArray(rows)) {
        listingUrls = rows.map((l) => ({ loc: `${origin}/p/${l.id}`, lastmod: l.last_renewed_at }))
      }
    } catch {
      // Sin datos: el sitemap sale solo con las páginas estáticas.
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls.map((u) => `  <url><loc>${esc(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
${listingUrls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${esc(u.lastmod)}</lastmod></url>`).join('\n')}
</urlset>`

  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600')
  res.send(xml)
}
