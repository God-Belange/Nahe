import qrcode from 'qrcode-generator'

/** Matrice de modules du QR code (true = module sombre). Correction d'erreur M, mode octets. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const size = qr.getModuleCount()
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)))
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const x of bytes) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))])
}

/** PNG 1 bit/pixel (noir et blanc), blocs deflate « stockés » : sans dépendance ni coût CPU notable. */
export function qrPng(text: string, scale = 8, quietZone = 4): Uint8Array<ArrayBuffer> {
  const matrix = qrMatrix(text)
  const modules = matrix.length + quietZone * 2
  const px = modules * scale
  const rowBytes = Math.ceil(px / 8)

  const raw = new Uint8Array((rowBytes + 1) * px).fill(0xff)
  for (let y = 0; y < px; y++) {
    const row = y * (rowBytes + 1)
    raw[row] = 0
    const my = Math.floor(y / scale) - quietZone
    if (my < 0 || my >= matrix.length) continue
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - quietZone
      if (mx >= 0 && mx < matrix.length && matrix[my]![mx]) {
        raw[row + 1 + (x >> 3)]! &= ~(0x80 >> (x & 7))
      }
    }
  }

  const blocks: number[] = [0x78, 0x01]
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(i + 65535, raw.length))
    const last = i + 65535 >= raw.length ? 1 : 0
    blocks.push(last, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255)
    for (const b of part) blocks.push(b)
  }
  blocks.push(...u32(adler32(raw)))

  const header = new Uint8Array([...u32(px), ...u32(px), 1, 0, 0, 0, 0])
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(blocks)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
