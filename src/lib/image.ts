import { IMAGE_MAX_BYTES } from '../../shared/constants'

const ATTEMPTS = [
  { side: 1600, quality: 0.85 },
  { side: 1280, quality: 0.75 },
  { side: 1000, quality: 0.65 },
  { side: 800, quality: 0.55 },
]

/** Redimensionne et recompresse en JPEG (orientation EXIF appliquée) pour tenir dans IMAGE_MAX_BYTES. */
export async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    let last: Blob | null = null
    for (const { side, quality } of ATTEMPTS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      last = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (last && last.size <= IMAGE_MAX_BYTES) return last
    }
    throw new Error('too_large')
  } finally {
    bitmap.close()
  }
}
