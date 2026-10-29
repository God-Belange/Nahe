const encoder = new TextEncoder()

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** Jeton opaque (32 octets = 256 bits par défaut), encodé base64url. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes))
}

export function randomId(): string {
  return crypto.randomUUID()
}

/** Caractères sans ambiguïté visuelle (ni I, L, O, 0, 1). */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function randomReference(length = 6): string {
  const limit = 256 - (256 % REFERENCE_ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]
    }
  }
  return `NAHE-${out}`
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function hmacBase64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

/** Format : pbkdf2-sha256$<itérations>$<sel base64>$<hash base64>. 100 000 est le maximum accepté par Workers. */
export const PBKDF2_ITERATIONS = 100_000

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  )
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16)
  const hash = await pbkdf2(password, salt, iterations)
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterRaw, saltB64, hashB64] = stored.split('$')
  const iterations = Number(iterRaw)
  if (scheme !== 'pbkdf2-sha256' || !saltB64 || !hashB64) return false
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false
  try {
    const actual = await pbkdf2(password, fromBase64(saltB64), iterations)
    return timingSafeEqual(toBase64(actual), hashB64)
  } catch {
    return false
  }
}
