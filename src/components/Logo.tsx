// Marca oficial de Dealr — wordmark "Deal" + "r" ámbar con el martillo de
// subasta como acento sobre la r. Valores EXACTOS del handoff de diseño
// (claude.ai/design, "Logo Dealr Final.dc.html"): el ícono del wordmark mide
// 0.667em, se posiciona a left:2.1em / top:-0.1em desde el inicio del texto
// (derivado de las coords del header 30px: icono 20px en top:21 left:91,
// texto en top:24 left:28 → (91-28)/30=2.1em, (21-24)/30=-0.1em; la versión
// clara de 48px confirma el mismo 101/48≈2.1em). OJO: el SVG del wordmark NO
// lleva el translate(7 0) ni la barra de base que sí tiene el ícono de app —
// es solo el martillo (2 rects rotados -45°).

import type { CSSProperties } from 'react'

// Martillo de subasta. `withBase`/`translate` para el ícono de app (fondo
// ámbar); el wordmark usa el martillo pelado, como en el diseño.
export function DealrMark({
  size = 24,
  color = '#ffb020',
  withBase = false,
  appIcon = false,
  className = '',
  style,
}: {
  size?: number
  color?: string
  withBase?: boolean
  appIcon?: boolean
  className?: string
  style?: CSSProperties
}) {
  const hammer = (
    <>
      <g transform="rotate(-45 60 60)">
        <rect x="34" y="30" width="52" height="26" rx="8" fill={color} />
        <rect x="54" y="60" width="12" height="34" rx="6" fill={color} />
      </g>
      {withBase && <rect x="20" y="96" width="44" height="10" rx="5" fill={color} opacity="0.55" />}
    </>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false" className={className} style={style}>
      {appIcon ? <g transform="translate(7 0)">{hammer}</g> : hammer}
    </svg>
  )
}

// Wordmark completo. `size` = font-size en px (todo lo demás escala en em).
// `dark`: texto negro para fondos claros (variante clara del logo).
export default function Logo({
  size = 28,
  className = '',
  dark = false,
}: {
  size?: number
  className?: string
  dark?: boolean
}) {
  const accent = dark ? '#e89b00' : '#ffb020'
  return (
    <span
      className={`relative inline-flex items-baseline font-bold ${className}`}
      style={{ fontSize: size, fontFamily: "'Space Grotesk', 'Inter', sans-serif", letterSpacing: '-0.03em', lineHeight: 1 }}
    >
      <span className={dark ? 'text-black' : 'text-white'}>Deal</span>
      <span style={{ color: accent }}>r</span>
      {/* Acento posicionado desde el INICIO del texto (no desde la r), como
          en el diseño: left/top medidos contra el inicio del wordmark. */}
      <DealrMark
        size={size * 0.667}
        color={accent}
        className="absolute"
        style={{ left: '2.1em', top: '-0.1em' }}
      />
    </span>
  )
}
