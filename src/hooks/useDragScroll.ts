import { useEffect, useRef } from 'react'

// Permite arrastrar con el mouse para scrollear horizontal (desktop). En touch
// NO interviene: el scroll nativo del navegador ya da el arrastre con momentum
// estilo iOS, y meterse ahí lo empeora. Devuelve un ref para el contenedor
// scrolleable (el que tiene overflow-x-auto).
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let down = false
    let startX = 0
    let startScroll = 0
    let moved = false

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return // touch: scroll nativo
      down = true
      moved = false
      startX = e.clientX
      startScroll = el.scrollLeft
    }
    const onMove = (e: PointerEvent) => {
      if (!down) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 3) moved = true
      el.scrollLeft = startScroll - dx
    }
    const onUp = () => {
      down = false
    }
    // Si el arrastre movió, cancelamos el click para no disparar el botón que
    // quedó debajo del dedo/cursor al soltar.
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation()
        e.preventDefault()
        moved = false
      }
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('click', onClick, true)
    }
  }, [])

  return ref
}
