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
