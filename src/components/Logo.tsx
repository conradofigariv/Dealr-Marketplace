// Marca oficial de Dealr — wordmark "Deal" + "r" ámbar + el martillo de
// subasta como acento. Fuente: proyecto "Logo para marketplace app" en
// claude.ai/design (archivo "Logo Dealr Final.dc.html").
//
// Todo en unidades relativas al `size` (px) que se pasa, así un mismo
// componente sirve para el header del feed (28px), el login (56px) y la
// pantalla de configuración inicial (48px) sin quedar desproporcionado.

import type { CSSProperties } from 'react'

// El ícono: dos barras rotadas -45° (cabeza + mango de martillo) + una
// barra tenue de base — un martillo de subasta, coherente con el feature
// de subastas de la app. Reutilizable suelto (ej. favicon, ícono de app)
// o como acento del wordmark.
export function DealrMark({
  size = 24,
  color = '#ffb020',
  withBase = false,
  className = '',
  style,
}: {
  size?: number
  color?: string
  withBase?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false" className={className} style={style}>
      <g transform="translate(7 0)">
        <g transform="rotate(-45 60 60)">
          <rect x="34" y="30" width="52" height="26" rx="8" fill={color} />
          <rect x="54" y="60" width="12" height="34" rx="6" fill={color} />
        </g>
        {withBase && <rect x="20" y="96" width="44" height="10" rx="5" fill={color} opacity="0.55" />}
      </g>
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
  return (
    <span
      className={`inline-flex items-baseline font-bold ${className}`}
      style={{ fontSize: size, fontFamily: "'Space Grotesk', 'Inter', sans-serif", letterSpacing: '-0.03em', lineHeight: 1 }}
    >
      <span className={dark ? 'text-black' : 'text-white'}>Deal</span>
      <span className="relative inline-block" style={{ color: dark ? '#e89b00' : '#ffb020' }}>
        r
        <DealrMark
          size={size * 0.4}
          color={dark ? '#e89b00' : '#ffb020'}
          className="absolute"
          // Acento apoyado arriba a la derecha de la "r", como en el diseño
          // original (ahí el ícono flota junto al asta de la r).
          style={{ top: '-0.32em', left: '0.7em' }}
        />
      </span>
    </span>
  )
}
