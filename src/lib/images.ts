import imageCompression from 'browser-image-compression'

// Lee orientación EXIF de un archivo de imagen (si existe).
async function getExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const view = new Uint8Array(e.target?.result as ArrayBuffer)
      // Marcador EXIF: 0xFFE1, luego EXIF\0, luego datos TIFF
      if (view[0] !== 0xff || view[1] !== 0xd8) {
        resolve(1) // Sin EXIF, orientación normal
        return
      }
      for (let i = 2; i < Math.min(view.length - 10, 65536); i++) {
        if (view[i] === 0xff && view[i + 1] === 0xe1) {
          if (view.slice(i + 4, i + 10).every((b, idx) => 'Exif\0\0'.charCodeAt(idx) === b)) {
            // Offset a IFD (TIFF header): i+10
            // Tag 0x0112 (Orientation)
            const isLittleEndian = view[i + 10 + 4] === 0x49
            const ifdStart = i + 10 + 4 + 4
            const numDirEntries = isLittleEndian ? (view[ifdStart + 1] << 8) | view[ifdStart] : (view[ifdStart] << 8) | view[ifdStart + 1]
            for (let j = 0; j < numDirEntries; j++) {
              const entryStart = ifdStart + 2 + j * 12
              const tag = isLittleEndian ? (view[entryStart + 1] << 8) | view[entryStart] : (view[entryStart] << 8) | view[entryStart + 1]
              if (tag === 0x0112) {
                const value = view[entryStart + 8]
                resolve(value || 1)
                return
              }
            }
          }
          resolve(1)
          return
        }
      }
      resolve(1)
    }
    reader.readAsArrayBuffer(file)
  })
}

// Rota una imagen en Canvas según su orientación EXIF (1-8).
async function rotateImageByOrientation(file: File, orientation: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        let w = img.width,
          h = img.height
        if (orientation > 4) [w, h] = [h, w]
        canvas.width = w
        canvas.height = h
        ctx.save()
        ctx.translate(w / 2, h / 2)
        if (orientation === 2) ctx.scale(-1, 1)
        else if (orientation === 3) ctx.rotate(Math.PI)
        else if (orientation === 4) {
          ctx.scale(1, -1)
        } else if (orientation === 5) {
          ctx.rotate(Math.PI / 2)
          ctx.scale(-1, 1)
        } else if (orientation === 6) ctx.rotate(Math.PI / 2)
        else if (orientation === 7) {
          ctx.rotate(Math.PI / 2)
          ctx.scale(1, -1)
        } else if (orientation === 8) ctx.rotate(-Math.PI / 2)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        ctx.restore()
        canvas.toBlob(
          (blob) => {
            resolve(new File([blob!], file.name, { type: 'image/jpeg' }))
          },
          'image/jpeg',
          0.95,
        )
      }
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

// Espeja horizontalmente una imagen (corrige fotos de cámara frontal que
// algunos teléfonos guardan ya invertidas, sin marca EXIF que lo indique).
export async function mirrorImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.translate(img.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0)
        canvas.toBlob(
          (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
          'image/jpeg',
          0.95,
        )
      }
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

// Compresión client-side antes de subir: la usa el DETALLE del producto.
// Estrategia = TAMAÑO objetivo, no calidad fija (que es lo malo):
//   - maxSizeMB (1MB) es el TECHO REAL: la librería baja la calidad
//     iterativamente hasta entrar bajo ese peso → empareja a todas, una foto
//     de 10MB termina en ~1MB.
//   - initialQuality (0.9) es el TECHO/punto de partida, no la calidad final:
//     si la foto ya entra bajo 1MB, se queda cerca de 0.9 (no la aplasta) —
//     así una foto ya justa no se rompe por re-comprimir. Solo baja de 0.9 si
//     hace falta para respetar el 1MB.
//   - maxWidthOrHeight (1920) achica la resolución primero (una foto de 4000px
//     de cámara no aporta nada en un marketplace).
// Corrige orientación EXIF.
export async function compressPhoto(file: File): Promise<File> {
  const orientation = await getExifOrientation(file)
  let processedFile = file
  if (orientation > 1) {
    processedFile = await rotateImageByOrientation(file, orientation)
  }
  return imageCompression(processedFile, {
    // 3MB de techo: con 1MB, la foto de 1920px al 90% (que suele pesar
    // ~1.5-2.5MB) se bajaba de calidad para entrar → se veía comprimida.
    // Con 3MB la mayoría entra sin tocar la calidad y se queda cerca de 0.9.
    // El egress del detalle sube algo, pero el detalle es bajo volumen (el
    // feed usa la miniatura).
    maxSizeMB: 3,
    maxWidthOrHeight: 1920,
    initialQuality: 0.9,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}

// Miniatura para el FEED (grilla + rieles): se ve chica pero se descarga
// muchísimo (cada visitante nuevo baja todas las portadas). 800px + calidad
// 78% → nítida en la grilla y sigue pesando ~90-110KB, ~8-10x menos que la
// grande. Ahí está el ahorro de egress real: si se hace mucho más pesada,
// vuelve el problema de egress del feed. El techo de 1MB le da aire pero el
// que manda es la calidad. Recibe la foto ya comprimida, no corrige EXIF.
export async function compressThumb(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 800,
    initialQuality: 0.78,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}

// Avatares: se ven chicos en pantalla, pero 512px a buena calidad evita
// que se vean pixelados en perfiles y badges. Corrige orientación EXIF.
export async function compressAvatar(file: File): Promise<File> {
  const orientation = await getExifOrientation(file)
  let processedFile = file
  if (orientation > 1) {
    processedFile = await rotateImageByOrientation(file, orientation)
  }
  return imageCompression(processedFile, {
    maxSizeMB: 0.12,
    maxWidthOrHeight: 512,
    initialQuality: 0.85,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}
