import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { adminApi, api, eventInput, login } from './helpers'
import { runMaintenance } from '../worker/services/maintenance'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const SVG = new Uint8Array(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))

async function upload(session: Awaited<ReturnType<typeof login>>, raw: Uint8Array<ArrayBuffer>, contentType = 'image/jpeg') {
  return adminApi(session, '/images', { method: 'POST', raw, contentType })
}

describe('images téléversées', () => {
  it('enregistre une image puis la sert publiquement avec un cache long', async () => {
    const admin = await login()
    const res = await upload(admin, JPEG)
    expect(res.status).toBe(201)
    expect(res.json.url).toMatch(/^\/api\/images\/[A-Za-z0-9_-]{22}$/)

    const served = await api(res.json.url.replace('/api', ''))
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('image/jpeg')
    expect(served.headers.get('Cache-Control')).toContain('immutable')
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('exige une session admin', async () => {
    const res = await api('/admin/images', { method: 'POST', raw: JPEG, contentType: 'image/jpeg' })
    expect(res.status).toBe(401)
  })

  it('refuse un SVG ou un contenu qui n\'est pas une image, quel que soit le type annoncé', async () => {
    const admin = await login()
    const svg = await upload(admin, SVG, 'image/jpeg')
    expect(svg.status).toBe(422)
    expect(svg.json.error.code).toBe('invalid_image')
    expect((await upload(admin, new Uint8Array(0))).status).toBe(400)
  })

  it('refuse une image trop lourde', async () => {
    const admin = await login()
    const big = new Uint8Array(1_000_001)
    big.set(JPEG)
    const res = await upload(admin, big)
    expect(res.status).toBe(422)
    expect(res.json.error.code).toBe('image_too_large')
  })

  it('renvoie 404 pour une image inconnue', async () => {
    expect((await api('/images/inconnue')).status).toBe(404)
  })

  it('accepte une image téléversée comme couverture d\'événement', async () => {
    const admin = await login()
    const { json } = await upload(admin, PNG, 'image/png')
    const created = await adminApi(admin, '/events', { method: 'POST', body: eventInput({ coverImageUrl: json.url }) })
    expect(created.status).toBe(201)
    expect(created.json.coverImageUrl).toBe(json.url)
  })

  it('refuse un chemin d\'image externe ou mal formé', async () => {
    const admin = await login()
    for (const coverImageUrl of ['/api/images/../admin/session', '/api/images/court', 'https://evil.example/x.png']) {
      const res = await adminApi(admin, '/events', { method: 'POST', body: eventInput({ coverImageUrl }) })
      expect(res.status).toBe(422)
    }
  })

  it('la maintenance supprime les images orphelines anciennes et garde les autres', async () => {
    const admin = await login()
    const used = (await upload(admin, JPEG)).json.url as string
    const orphanOld = (await upload(admin, PNG, 'image/png')).json.url as string
    const orphanRecent = (await upload(admin, PNG, 'image/png')).json.url as string
    await adminApi(admin, '/events', { method: 'POST', body: eventInput({ coverImageUrl: used }) })

    const idOf = (url: string) => url.split('/').pop()!
    await env.DB.prepare('UPDATE images SET created_at = ?1 WHERE id IN (?2, ?3)')
      .bind(new Date(Date.now() - 2 * 86_400_000).toISOString(), idOf(used), idOf(orphanOld))
      .run()

    await runMaintenance(env, new Date())

    expect((await api(used.replace('/api', ''))).status).toBe(200)
    expect((await api(orphanOld.replace('/api', ''))).status).toBe(404)
    expect((await api(orphanRecent.replace('/api', ''))).status).toBe(200)
  })
})
