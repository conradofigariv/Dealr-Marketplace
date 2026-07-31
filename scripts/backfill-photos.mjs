// Repasada del inventario de fotos ya subidas a Storage.
//
// Hace dos cosas, y la segunda suele ahorrar más que la primera:
//   1. Recomprime las fotos que superan el techo nuevo (1440px / 1.5MB). Las
//      viejas se subieron a 1920px/3MB (ver images.ts::compressPhoto).
//   2. Genera las MINIATURAS que faltan. Al publicar, la miniatura se sube en
//      un try/catch best-effort (Publish.tsx): si falló, esa publicación sirve
//      la foto COMPLETA en el feed, que es la pantalla más visitada. Ahí está
//      el desperdicio grande.
//
// CUIDADO: sobrescribe objetos de producción y Storage no tiene papelera. Por
// eso, antes de pisar cada foto, guarda el original en ./backup-photos/.
//
// Uso:
//   npm i sharp --no-save                  # sin tocar package.json
//   export SUPABASE_URL=https://xxx.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=...   # Settings -> API -> service_role
//   node scripts/backfill-photos.mjs       # DRY RUN: solo informa
//   node scripts/backfill-photos.mjs --apply
//
// Es resumible: anota cada ruta terminada en ./backfill-log.json, así que si
// se corta se vuelve a correr y sigue donde quedó.

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BUCKET = 'listing-photos'
// Mismos números que images.ts: si se cambian allá, cambiarlos acá.
const FULL_MAX_SIDE = 1440
const FULL_MAX_BYTES = 1.5 * 1024 * 1024
const FULL_QUALITY = 90
const THUMB_MAX_SIDE = 800
const THUMB_MAX_BYTES = 1 * 1024 * 1024
const THUMB_QUALITY = 78

const CONCURRENCY = 4
const BACKUP_DIR = './backup-photos'
const LOG_FILE = './backfill-log.json'

const APPLY = process.argv.includes('--apply')
const ONLY_ACTIVE = process.argv.includes('--only-active')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.')
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

// HEAD al objeto público: devuelve el peso sin bajar el cuerpo (o sea, sin
// gastar egress). Con eso alcanza para decidir qué tocar en el dry run.
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
console.log(`Modo: ${APPLY ? 'APLICAR (escribe en Storage)' : 'DRY RUN (no escribe nada)'}\n`)

const ext = {}
for (const p of paths) {
  const m = p.match(/\.([a-z0-9]+)$/i)
  ext[m ? m[1].toLowerCase() : '(sin extensión)'] = (ext[m ? m[1].toLowerCase() : '(sin extensión)'] ?? 0) + 1
}
console.log('Extensiones:', ext, '\n')

console.log('Relevando pesos (HEAD, no gasta egress)...')
const survey = await pool(paths, async (p) => {
  const [full, thumb] = await Promise.all([head(p), head(thumbPath(p))])
  return { path: p, full, thumb }
})

const missing = survey.filter((s) => s.full == null)
const needThumb = survey.filter((s) => s.full != null && s.thumb == null)
const needShrink = survey.filter((s) => s.full != null && s.full > FULL_MAX_BYTES)
const todo = survey.filter((s) => s.full != null && (s.thumb == null || s.full > FULL_MAX_BYTES))
const downloadBytes = todo.reduce((a, s) => a + s.full, 0)
const totalFull = survey.reduce((a, s) => a + (s.full ?? 0), 0)

console.log(`\n--- Relevamiento ---`)
console.log(`Peso total de las fotos grandes:   ${mb(totalFull)}`)
console.log(`Sin miniatura (sirven la grande en el feed): ${needThumb.length}`)
console.log(`Por encima de ${mb(FULL_MAX_BYTES)}:              ${needShrink.length}`)
if (missing.length) console.log(`Rotas / no existen en Storage:     ${missing.length}`)
console.log(`\nA procesar: ${todo.length} fotos · hay que bajar ${mb(downloadBytes)} (ese es el costo de egress de la pasada, una sola vez)`)

if (!todo.length) {
  console.log('\nNada para hacer.')
  process.exit(0)
}

if (!APPLY) {
  console.log('\nDry run: no se tocó nada. Volvé a correr con --apply para aplicarlo.')
  process.exit(0)
}

// ---------- 2. Aplicar ----------

const done = existsSync(LOG_FILE) ? JSON.parse(await readFile(LOG_FILE, 'utf8')) : {}
let savedFull = 0
let madeThumbs = 0
let shrunk = 0
let failed = 0

async function backup(path, buf) {
  const dest = join(BACKUP_DIR, path)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
}

for (const item of todo) {
  if (done[item.path]) continue
  try {
    const r = await fetch(publicUrl(item.path))
    if (!r.ok) throw new Error(`descarga ${r.status}`)
    const original = Buffer.from(await r.arrayBuffer())

    // El original se guarda ANTES de pisar nada. Ya lo bajamos, así que la
    // copia de seguridad no cuesta egress extra.
    await backup(item.path, original)

    if (item.thumb == null) {
      const thumb = await encode(original, THUMB_MAX_SIDE, THUMB_MAX_BYTES, THUMB_QUALITY)
      const { error: e } = await supabase.storage
        .from(BUCKET)
        .upload(thumbPath(item.path), thumb, { contentType: 'image/webp', upsert: true })
      if (e) throw new Error(`subida miniatura: ${e.message}`)
      madeThumbs++
      console.log(`  + miniatura ${item.path} → ${kb(thumb.length)} (la grande era ${kb(item.full)})`)
    }

    if (item.full > FULL_MAX_BYTES) {
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

    done[item.path] = true
    await writeFile(LOG_FILE, JSON.stringify(done, null, 2))
  } catch (err) {
    failed++
    console.error(`  ! ${item.path}: ${err.message}`)
  }
}

console.log(`\n--- Resultado ---`)
console.log(`Miniaturas creadas: ${madeThumbs}`)
console.log(`Fotos recomprimidas: ${shrunk} (${mb(savedFull)} menos por cada visita que las baje)`)
if (failed) console.log(`Fallaron: ${failed} (se pueden reintentar volviendo a correr el script)`)
console.log(`\nOriginales respaldados en ${BACKUP_DIR}/ — no los borres hasta revisar que todo se ve bien.`)
