// Repasada del inventario de fotos ya subidas a Storage.
//
// Está partido en dos fases porque tienen riesgos MUY distintos:
//
//   FASE 1 (default) — generar las MINIATURAS que faltan.
//     Es ADITIVA: crea objetos `.thumb.webp` nuevos, nunca pisa nada. Si algo
//     sale mal, se borran y listo. Al publicar, la miniatura se sube en un
//     try/catch best-effort (Publish.tsx), así que una publicación cuya
//     miniatura falló sirve la foto COMPLETA en el feed — la pantalla más
//     visitada. Acá está el ahorro grande y no cuesta ningún riesgo.
//
//   FASE 2 (--recompress) — recomprimir las fotos que superan 1440px/1.5MB.
//     Es DESTRUCTIVA: sobrescribe el original y Storage no tiene papelera.
//     No hace respaldo a disco a propósito: corriendo desde la web, el disco
//     de esta sesión se recicla al terminar, así que un backup local sería
//     una falsa red de seguridad. Lo que sí garantiza: solo pisa si el
//     resultado pesa MENOS, y usa exactamente los mismos parámetros que
//     images.ts::compressPhoto, que ya validaste a ojo en una publicación
//     real. Lo único irreversible es bajar de 1920px a 1440px.
//
// Uso:
//   node scripts/backfill-photos.mjs                # DRY RUN de la fase 1
//   node scripts/backfill-photos.mjs --apply        # aplica la fase 1
//   node scripts/backfill-photos.mjs --recompress            # dry run de ambas
//   node scripts/backfill-photos.mjs --recompress --apply    # aplica ambas
//
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (la service
// role saltea la RLS: hace falta para escribir sobre carpetas de otros
// usuarios). Es resumible: anota lo hecho en ./backfill-log.json.

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const BUCKET = 'listing-photos'
// Mismos números que images.ts: si se cambian allá, cambiarlos acá.
const FULL_MAX_SIDE = 1440
const FULL_MAX_BYTES = 1.5 * 1024 * 1024
const FULL_QUALITY = 90
const THUMB_MAX_SIDE = 800
const THUMB_MAX_BYTES = 1 * 1024 * 1024
const THUMB_QUALITY = 78

const CONCURRENCY = 4
const LOG_FILE = './backfill-log.json'

const APPLY = process.argv.includes('--apply')
const RECOMPRESS = process.argv.includes('--recompress')
const ONLY_ACTIVE = process.argv.includes('--only-active')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`
const publicUrl = (p) => `${url}/storage/v1/object/public/${BUCKET}/${p}`
const thumbPath = (p) => p.replace(/\.[a-z0-9]+$/i, '') + '.thumb.webp'

// Encodea a webp respetando un techo de peso: baja la calidad de a poco solo
// si hace falta (misma estrategia que browser-image-compression en el front).
async function encode(buf, maxSide, maxBytes, startQuality) {
  let q = startQuality
  for (;;) {
    const out = await sharp(buf)
      .rotate() // respeta EXIF si quedó alguna foto vieja sin normalizar
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer()
    if (out.length <= maxBytes || q <= 60) return out
    q -= 8
  }
}

// HEAD al objeto público: devuelve el peso sin bajar el cuerpo, o sea sin
// gastar egress. Con eso alcanza para el relevamiento completo.
async function head(path) {
  const r = await fetch(publicUrl(path), { method: 'HEAD' })
  if (!r.ok) return null
  return Number(r.headers.get('content-length') ?? 0)
}

async function pool(items, worker) {
  const results = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await worker(items[idx], idx)
      }
    }),
  )
  return results
}

// ---------- 1. Relevamiento ----------

let q = supabase.from('listings').select('id, status, photos')
if (ONLY_ACTIVE) q = q.eq('status', 'active')
const { data: listings, error } = await q
if (error) {
  console.error('No se pudo leer listings:', error.message)
  process.exit(1)
}

// Una misma foto puede repetirse si se duplicó una publicación: deduplicamos
// para no bajarla ni pisarla dos veces.
const paths = [...new Set(listings.flatMap((l) => l.photos ?? []))].filter(
  (p) => typeof p === 'string' && p && !p.includes('.thumb.') && !/^https?:\/\//i.test(p),
)

console.log(`${listings.length} publicaciones · ${paths.length} fotos únicas`)
console.log(`Fases: miniaturas${RECOMPRESS ? ' + recompresión' : ''}`)
console.log(`Modo: ${APPLY ? 'APLICAR (escribe en Storage)' : 'DRY RUN (no escribe nada)'}\n`)

const ext = {}
for (const p of paths) {
  const m = p.match(/\.([a-z0-9]+)$/i)
  const e = m ? m[1].toLowerCase() : '(sin extensión)'
  ext[e] = (ext[e] ?? 0) + 1
}
console.log('Extensiones:', ext, '\n')

console.log('Relevando pesos (HEAD, no gasta egress)...')
const survey = await pool(paths, async (p) => {
  const [full, thumb] = await Promise.all([head(p), head(thumbPath(p))])
  return { path: p, full, thumb }
})

const missing = survey.filter((s) => s.full == null)
const alive = survey.filter((s) => s.full != null)
const needThumb = alive.filter((s) => s.thumb == null)
const needShrink = RECOMPRESS ? alive.filter((s) => s.full > FULL_MAX_BYTES) : []
const todo = alive.filter((s) => s.thumb == null || (RECOMPRESS && s.full > FULL_MAX_BYTES))
const downloadBytes = todo.reduce((a, s) => a + s.full, 0)

console.log(`\n--- Relevamiento ---`)
console.log(`Peso total de las fotos grandes:            ${mb(alive.reduce((a, s) => a + s.full, 0))}`)
console.log(`Sin miniatura (sirven la grande en el feed): ${needThumb.length}`)
if (needThumb.length) {
  console.log(`  → hoy el feed baja ${mb(needThumb.reduce((a, s) => a + s.full, 0))} por esas; con miniatura serían ~${mb(needThumb.length * 100 * 1024)}`)
}
if (RECOMPRESS) console.log(`Por encima de ${mb(FULL_MAX_BYTES)}:                       ${needShrink.length}`)
if (missing.length) console.log(`Rotas / no existen en Storage:              ${missing.length}`)
console.log(`\nA procesar: ${todo.length} fotos · hay que bajar ${mb(downloadBytes)} (costo de egress de la pasada, una sola vez)`)

if (!todo.length) {
  console.log('\nNada para hacer.')
  process.exit(0)
}

if (!APPLY) {
  console.log(`\nDry run: no se tocó nada. Para aplicarlo: --apply${RECOMPRESS ? ' --recompress' : ''}`)
  process.exit(0)
}

// ---------- 2. Aplicar ----------

const done = existsSync(LOG_FILE) ? JSON.parse(await readFile(LOG_FILE, 'utf8')) : {}
let savedFull = 0
let madeThumbs = 0
let shrunk = 0
let failed = 0

for (const item of todo) {
  const key = `${item.path}|${RECOMPRESS ? 'full' : 'thumb'}`
  if (done[key]) continue
  try {
    const r = await fetch(publicUrl(item.path))
    if (!r.ok) throw new Error(`descarga ${r.status}`)
    const original = Buffer.from(await r.arrayBuffer())

    if (item.thumb == null) {
      const thumb = await encode(original, THUMB_MAX_SIDE, THUMB_MAX_BYTES, THUMB_QUALITY)
      const { error: e } = await supabase.storage
        .from(BUCKET)
        .upload(thumbPath(item.path), thumb, { contentType: 'image/webp', upsert: true })
      if (e) throw new Error(`subida miniatura: ${e.message}`)
      madeThumbs++
      console.log(`  + miniatura ${item.path} → ${kb(thumb.length)} (la grande pesa ${kb(item.full)})`)
    }

    if (RECOMPRESS && item.full > FULL_MAX_BYTES) {
      const out = await encode(original, FULL_MAX_SIDE, FULL_MAX_BYTES, FULL_QUALITY)
      // Red de seguridad: si no baja de peso, dejamos la original en paz.
      if (out.length < original.length) {
        const { error: e } = await supabase.storage
          .from(BUCKET)
          .upload(item.path, out, { contentType: 'image/webp', upsert: true })
        if (e) throw new Error(`subida grande: ${e.message}`)
        savedFull += original.length - out.length
        shrunk++
        console.log(`  ↓ ${item.path}: ${kb(original.length)} → ${kb(out.length)}`)
      } else {
        console.log(`  = ${item.path}: no bajaba de peso, se deja como está`)
      }
    }

    done[key] = true
    await writeFile(LOG_FILE, JSON.stringify(done, null, 2))
  } catch (err) {
    failed++
    console.error(`  ! ${item.path}: ${err.message}`)
  }
}

console.log(`\n--- Resultado ---`)
console.log(`Miniaturas creadas: ${madeThumbs}`)
if (RECOMPRESS) console.log(`Fotos recomprimidas: ${shrunk} (${mb(savedFull)} menos por cada visita que las baje)`)
if (failed) console.log(`Fallaron: ${failed} (se reintentan volviendo a correr el script)`)
