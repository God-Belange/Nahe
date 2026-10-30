import { IMAGE_MAX_BYTES, IMAGE_URL_PREFIX, type ImageContentType } from '../../shared/constants'
import { ApiError, notFound } from '../lib/errors'
import { randomToken } from '../lib/crypto'

const ORPHAN_GRACE_MS = 86_400_000

/** Type réel d'après les premiers octets : le Content-Type annoncé par le client n'est pas fiable. */
function sniffImageType(b: Uint8Array): ImageContentType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function saveImage(env: Env, body: ArrayBuffer, now: Date): Promise<{ url: string }> {
  if (body.byteLength === 0) throw new ApiError(400, 'invalid_image', 'Aucune image reçue.')
  if (body.byteLength > IMAGE_MAX_BYTES) {
    throw new ApiError(422, 'image_too_large', 'Image trop lourde (1 Mo maximum).')
  }
  const bytes = new Uint8Array(body)
  const contentType = sniffImageType(bytes)
  if (!contentType) {
    throw new ApiError(422, 'invalid_image', 'Format non pris en charge (JPEG, PNG ou WebP).')
  }
  const id = randomToken(16)
  await env.DB.prepare(
    'INSERT INTO images (id, content_type, data, size_bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(id, contentType, bytesToBase64(bytes), bytes.length, now.toISOString())
    .run()
  return { url: `${IMAGE_URL_PREFIX}${id}` }
}

export async function getImage(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT content_type, data FROM images WHERE id = ?1')
    .bind(id)
    .first<{ content_type: ImageContentType; data: string }>()
  if (!row) throw notFound('image_not_found', 'Image introuvable.')
  return { contentType: row.content_type, bytes: base64ToBytes(row.data) }
}

/** Supprime les images qu'aucun événement ni réglage ne référence (remplacées ou abandonnées), après un délai de grâce. */
export async function purgeOrphanImages(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS).toISOString()
  const result = await env.DB.prepare(
    `DELETE FROM images
     WHERE created_at < ?1
       AND ?2 || id NOT IN (SELECT cover_image_url FROM events WHERE cover_image_url IS NOT NULL)
       AND ?2 || id NOT IN (SELECT wero_qr_image_url FROM payment_settings WHERE wero_qr_image_url IS NOT NULL)`,
  )
    .bind(cutoff, IMAGE_URL_PREFIX)
    .run()
  return result.meta.changes
}
