import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'

// Imagen con skeleton de carga: mientras baja muestra un glow (shimmer) y la
// foto sube de opacidad al cargar. El shimmer va en un contenedor que llena el
// espacio disponible (absolute inset-0), así que el padre debe definir el
// tamaño (aspect-square, h-full, etc.) y ser `relative`/`overflow-hidden`.
type Props = ImgHTMLAttributes<HTMLImageElement> & {
  // Clases del contenedor que envuelve la imagen.
  wrapperClassName?: string
  // Qué render mostrar si la imagen falla (en vez de la img rota).
  fallback?: React.ReactNode
  // Si `src` falla, se prueba ESTA antes de rendirse (ej. la miniatura del
  // feed no existe → cae a la foto grande). Ver thumbUrl/photoUrl.
  fallbackSrc?: string
  onError?: ImgHTMLAttributes<HTMLImageElement>['onError']
}

export default function SmartImage({ wrapperClassName, fallback, fallbackSrc, className, onError, onLoad, src, ...img }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(src)

  // Si cambia la `src` de props, reiniciamos el estado.
  useEffect(() => {
    setCurrentSrc(src)
    setFailed(false)
    setLoaded(false)
  }, [src])

  return (
    <div className={`relative overflow-hidden ${!loaded && !failed ? 'img-shimmer' : ''} ${wrapperClassName ?? ''}`}>
      {failed && fallback ? (
        fallback
      ) : (
        <img
          {...img}
          src={currentSrc}
          onLoad={(e) => {
            setLoaded(true)
            onLoad?.(e)
          }}
          onError={(e) => {
            // Probar la versión grande antes de dar la imagen por fallida.
            if (fallbackSrc && currentSrc !== fallbackSrc) {
              setCurrentSrc(fallbackSrc)
              return
            }
            setFailed(true)
            onError?.(e)
          }}
          className={`${className ?? ''} transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  )
}
