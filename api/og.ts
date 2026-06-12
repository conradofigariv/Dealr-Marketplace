// Preview rica para crawlers (WhatsApp, Instagram, etc.) en /p/:id.
// Los bots no ejecutan JavaScript: este endpoint les sirve un HTML
// mínimo con Open Graph (foto, título, precio). vercel.json lo enruta
// solo cuando el user-agent es un crawler conocido.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatPrice(price: number, currency: string): string {
  const n = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(price)
  return currency === 'USD' ? `USD ${n}` : `$ ${n}`
}

export default async function handler(
  req: { query: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined> },
  res: {
    setHeader: (k: string, v: string) => void
    status: (c: number) => { send: (b: string) => void }
    send: (b: string) => void
  },
) {
  const id = String(req.query.id ?? '')
  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  const pageUrl = `https://${host}/p/${id}`

  let title = 'Dealr'
  let description = 'Comprá y vendé cerca tuyo, con confianza.'
  let image = ''

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (isUuid && supabaseUrl && anonKey) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/listings?id=eq.${id}&status=eq.active&select=title,description,price,currency,photos`,
        { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } },
      )
      const rows = (await r.json()) as {
        title: string
        description: string
        price: number
        currency: string
        photos: string[]
      }[]
      const listing = rows?.[0]
      if (listing) {
        title = `${listing.title} — ${formatPrice(listing.price, listing.currency)}`
        description = listing.description?.slice(0, 160) || 'Publicado en Dealr'
        if (listing.photos?.[0]) {
          image = `${supabaseUrl}/storage/v1/object/public/listing-photos/${listing.photos[0]}`
        }
      }
    } catch {
      // sin datos: servimos la preview genérica
    }
  }

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Dealr" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
${image ? `<meta property="og:image" content="${esc(image)}" />` : ''}
<meta property="og:url" content="${esc(pageUrl)}" />
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
<meta http-equiv="refresh" content="0;url=${esc(pageUrl)}" />
</head>
<body></body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600')
  res.send(html)
}
