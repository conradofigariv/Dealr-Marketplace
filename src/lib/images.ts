import imageCompression from 'browser-image-compression'

// Compresión client-side antes de subir: max 1920px lado mayor,
// calidad 85%, objetivo ~0,4-1MB por foto. Nítida en pantallas modernas
// sin llegar a pesar como el original de cámara.
export async function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    initialQuality: 0.85,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}

// Avatares: se ven chicos en pantalla, pero 512px a buena calidad evita
// que se vean pixelados en perfiles y badges.
export async function compressAvatar(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.12,
    maxWidthOrHeight: 512,
    initialQuality: 0.85,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}
