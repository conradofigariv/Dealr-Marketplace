import imageCompression from 'browser-image-compression'

// Compresión client-side antes de subir: max 1200px lado mayor,
// calidad 75%, objetivo 50-150KB por foto.
export async function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.15,
    maxWidthOrHeight: 1200,
    initialQuality: 0.75,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}

// Avatares: se ven chicos (máx 80px en pantalla), 512px alcanza de sobra.
export async function compressAvatar(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.05,
    maxWidthOrHeight: 512,
    initialQuality: 0.8,
    fileType: 'image/webp',
    useWebWorker: true,
  })
}
