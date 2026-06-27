// Confeti sin dependencias: una ráfaga corta sobre un <canvas> a pantalla
// completa que se autodestruye. Para celebrar momentos (publicar, ganar una
// subasta). Respeta prefers-reduced-motion (no hace nada).

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  size: number
  color: string
}

const COLORS = ['#f59e0b', '#ffffff', '#34d399', '#60a5fa', '#f472b6', '#fbbf24']

// Evita dos ráfagas (dos canvas + dos loops) si se llama seguido.
let running = false

export function burstConfetti(count = 120) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (running) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }
  running = true
  ctx.scale(dpr, dpr)

  // Dos surtidores desde abajo, en diagonal hacia el centro (estilo "cañón").
  const pieces: Piece[] = []
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7
    const speed = 9 + Math.random() * 9
    pieces.push({
      x: fromLeft ? w * 0.15 : w * 0.85,
      y: h + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      size: 6 + Math.random() * 6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    })
  }

  const gravity = 0.28
  const drag = 0.992
  let frame = 0
  const maxFrames = 180 // ~3s a 60fps

  function tick() {
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    frame++
    for (const p of pieces) {
      p.vy += gravity
      p.vx *= drag
      p.vy *= drag
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vrot
      const alpha = Math.max(0, 1 - frame / maxFrames)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx.restore()
    }
    if (frame < maxFrames) {
      requestAnimationFrame(tick)
    } else {
      canvas.remove()
      running = false
    }
  }
  requestAnimationFrame(tick)
}
