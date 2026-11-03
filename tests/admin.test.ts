import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { adminApi, api, configurePayments, freshIp, login, makeEvent, reserve, TEST_ADMIN_PASSWORD } from './helpers'

describe('authentification admin', () => {
  it.each([
    ['GET', '/dashboard'],
    ['GET', '/events'],
    ['POST', '/events'],
    ['GET', '/reservations'],
    ['GET', '/reservations.csv'],
    ['POST', '/reservations/x/confirm'],
    ['DELETE', '/reservations/x'],
    ['GET', '/payment-settings'],
    ['PUT', '/payment-settings'],
  ])('refuse %s /admin%s sans session (401)', async (method, path) => {
    const res = await api(`/admin${path}`, { method, ...(method !== 'GET' ? { body: {} } : {}) })
    expect(res.status).toBe(401)
    expect(res.json.error.code).toBe('unauthenticated')
  })

  it('refuse un mauvais mot de passe', async () => {
    const res = await api('/admin/session', { method: 'POST', body: { password: 'faux' } })
    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('ouvre une session avec un cookie __Host- HttpOnly, Secure, SameSite=Strict', async () => {
    const res = await api('/admin/session', { method: 'POST', body: { password: TEST_ADMIN_PASSWORD } })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(/^__Host-nahe_session=[A-Za-z0-9_-]{43};/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Domain')
    expect(res.json.csrfToken).toBeTruthy()
  })

  it('chaque connexion crée une nouvelle session (rotation)', async () => {
    const a = await login()
    const b = await login()
    expect(a.cookie).not.toBe(b.cookie)
    expect(a.csrf).not.toBe(b.csrf)
  })

  it('GET /admin/session renvoie l\'état et le jeton CSRF', async () => {
    const anonymous = await api('/admin/session')
    expect(anonymous.json).toEqual({ authenticated: false })
    const admin = await login()
    const res = await api('/admin/session', { cookie: admin.cookie })
    expect(res.json).toEqual({ authenticated: true, csrfToken: admin.csrf, role: 'admin' })
  })

  it('limite les échecs de connexion : 5 par 15 minutes et par IP', async () => {
    const ip = freshIp()
    const attempt = (password: string) =>
      api('/admin/session', { method: 'POST', body: { password }, ip })
    for (let i = 0; i < 5; i++) expect((await attempt('faux')).status).toBe(401)
    const blocked = await attempt(TEST_ADMIN_PASSWORD)
    expect(blocked.status).toBe(429)
    // une autre IP n'est pas affectée
    expect((await api('/admin/session', { method: 'POST', body: { password: TEST_ADMIN_PASSWORD } })).status).toBe(200)
  })

  it('une session expirée est refusée', async () => {
    const admin = await login()
    expect((await adminApi(admin, '/dashboard')).status).toBe(200)
    await env.DB.prepare("UPDATE admin_sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run()
    const res = await adminApi(admin, '/dashboard')
    expect(res.status).toBe(401)
  })

  it('la déconnexion invalide la session côté serveur', async () => {
    const admin = await login()
    const out = await adminApi(admin, '/session', { method: 'DELETE' })
    expect(out.status).toBe(200)
    expect((await adminApi(admin, '/dashboard')).status).toBe(401)
  })

  it('ne stocke ni le jeton de session ni le jeton CSRF en clair', async () => {
    const admin = await login()
    const row = await env.DB.prepare('SELECT session_token_hash, csrf_token_hash FROM admin_sessions').first<any>()
    expect(row.session_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(admin.cookie).not.toContain(row.session_token_hash)
    expect(row.csrf_token_hash).not.toBe(admin.csrf)
  })
})

describe('CSRF et origine', () => {
  it('refuse une requête mutante sans jeton CSRF', async () => {
    const admin = await login()
    const res = await api('/admin/events', { method: 'POST', body: {}, cookie: admin.cookie })
    expect(res.status).toBe(403)
    expect(res.json.error.code).toBe('bad_csrf')
  })

  it('refuse un jeton CSRF incorrect', async () => {
    const admin = await login()
    const res = await api('/admin/events', { method: 'POST', body: {}, cookie: admin.cookie, csrf: 'faux' })
    expect(res.status).toBe(403)
  })

  it('refuse un en-tête Origin étranger ou absent', async () => {
    const admin = await login()
    const foreign = await adminApi(admin, '/events', { method: 'POST', body: {}, origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(foreign.json.error.code).toBe('bad_origin')
    const missing = await adminApi(admin, '/events', { method: 'POST', body: {}, origin: null })
    expect(missing.status).toBe(403)
  })

  it('refuse aussi les POST publics depuis une autre origine', async () => {
    await configurePayments()
    const event = await makeEvent()
    const res = await api(`/events/${event.id}/reservations`, {
      method: 'POST',
      body: { firstName: 'A', lastName: 'B', email: 'a@b.fr' },
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('une requête GET authentifiée ne demande pas de jeton CSRF', async () => {
    const admin = await login()
    expect((await api('/admin/dashboard', { cookie: admin.cookie })).status).toBe(200)
  })
})

describe('en-têtes et erreurs API', () => {
  it('ajoute les en-têtes de sécurité', async () => {
    const res = await api('/events')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it('renvoie une erreur JSON pour une route inconnue et un JSON invalide', async () => {
    const nf = await api('/inconnu')
    expect(nf.status).toBe(404)
    expect(nf.json.error.code).toBe('not_found')
    const admin = await login()
    const bad = await fetchRaw(admin)
    expect(bad.status).toBe(400)
  })
})

async function fetchRaw(admin: { cookie: string; csrf: string }) {
  const { exports } = await import('cloudflare:workers')
  const res = await exports.default.fetch(
    new Request('https://nahe.test/api/admin/events', {
      method: 'POST',
      headers: { Origin: 'https://nahe.test', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json' },
      body: '{pas du json',
    }),
  )
  return res
}

describe('liste, filtres, export CSV', () => {
  it('filtre par recherche, statut et événement', async () => {
    await configurePayments()
    const a = await makeEvent({ title: 'Soirée A', capacity: 20 })
    const b = await makeEvent({ title: 'Soirée B', capacity: 20 })
    await reserve(a.id, { firstName: 'Alice', lastName: 'Martin', email: 'alice@example.com' })
    await reserve(b.id, { firstName: 'Bob', lastName: 'Dupont', email: 'bob@example.com' })
    const admin = await login()
    const all = await adminApi(admin, '/reservations')
    expect(all.json.total).toBe(2)
    expect((await adminApi(admin, '/reservations?q=alice')).json.items).toHaveLength(1)
    expect((await adminApi(admin, '/reservations?q=Bob Dupont')).json.items).toHaveLength(1)
    const ref = all.json.items[0].reference
    expect((await adminApi(admin, `/reservations?q=${ref}`)).json.items).toHaveLength(1)
    expect((await adminApi(admin, `/reservations?eventId=${a.id}`)).json.items).toHaveLength(1)
    expect((await adminApi(admin, '/reservations?status=confirmed')).json.items).toHaveLength(0)
    expect((await adminApi(admin, '/reservations?status=pending')).json.items).toHaveLength(2)
    expect((await adminApi(admin, '/reservations?status=bidon')).status).toBe(422)
    expect((await adminApi(admin, '/reservations?q=%25')).json.items).toHaveLength(0)
  })

  it('exporte un CSV UTF-8 avec neutralisation des formules', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 20 })
    await reserve(event.id, { firstName: '=HYPERLINK("http://evil")', lastName: '+cmd', email: 'x@example.com', phone: '0612345678' })
    await reserve(event.id, { firstName: '@SUM(1)', lastName: 'Dupont; "Jr"', email: 'y@example.com' })
    const admin = await login()
    const res = await adminApi(admin, '/reservations.csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.text.charCodeAt(0)).toBe(0xfeff)
    const lines = res.text.slice(1).trim().split('\r\n')
    expect(lines[0]).toContain('Référence;Événement')
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(res.text).toContain(";'+cmd;")
    expect(res.text).toContain(";'@SUM(1);")
    expect(res.text).toContain('"Dupont; ""Jr"""')
    expect(res.text).not.toMatch(/(^|;)=HYPERLINK/m)
    expect(lines).toHaveLength(3)
  })
})

describe('tableau de bord', () => {
  it('sépare le montant encaissé du montant restant à collecter', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000, capacity: 20 })
    await reserve(event.id, { quantity: 2 }) // 20 € confirmés
    await reserve(event.id, { quantity: 3 }) // 30 € en attente
    const admin = await login()
    const list = await adminApi(admin, '/reservations')
    const toConfirm = list.json.items.find((r: { quantity: number }) => r.quantity === 2)
    await adminApi(admin, `/reservations/${toConfirm.id}/confirm`, { method: 'POST' })
    const stats = (await adminApi(admin, '/dashboard')).json
    expect(stats).toMatchObject({
      eventsTotal: 1,
      eventsUpcoming: 1,
      confirmedParticipants: 2,
      pendingReservations: 1,
      collectedCents: 2000,
      outstandingCents: 3000,
      availablePlaces: 15,
      declaredPayments: 0,
    })
  })

  it('ne compte plus les réservations expirées ni annulées', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000 })
    await reserve(event.id, { quantity: 2 })
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    await adminApi(admin, `/reservations/${id}/cancel`, { method: 'POST' })
    const stats = (await adminApi(admin, '/dashboard')).json
    expect(stats.outstandingCents).toBe(0)
    expect(stats.pendingReservations).toBe(0)
    expect(stats.availablePlaces).toBe(10)
  })
})

describe('paramètres de paiement', () => {
  it('enregistre et relit les paramètres', async () => {
    const admin = await login()
    const put = await adminApi(admin, '/payment-settings', {
      method: 'PUT',
      body: {
        weroInstructions: 'Wero au 06…',
        weroQrImageUrl: '/images/wero-qr.png',
        paypalMeUrl: 'https://www.paypal.me/monCompte',
        revolutMeUrl: 'https://revolut.me/monCompte',
        pendingTtlHours: 48,
      },
    })
    expect(put.status).toBe(200)
    const get = await adminApi(admin, '/payment-settings')
    expect(get.json).toMatchObject({ pendingTtlHours: 48, weroQrImageUrl: '/images/wero-qr.png', revolutMeUrl: 'https://revolut.me/monCompte' })
  })

  it.each([
    ['un autre domaine', { paypalMeUrl: 'https://evil.example/paypal.me/x' }, 'paypalMeUrl'],
    ['un faux sous-domaine', { paypalMeUrl: 'https://paypal.me.evil.example/x' }, 'paypalMeUrl'],
    ['HTTP', { paypalMeUrl: 'http://paypal.me/x' }, 'paypalMeUrl'],
    ['un autre domaine Revolut', { revolutMeUrl: 'https://evil.example/revolut.me/x' }, 'revolutMeUrl'],
    ['Revolut en HTTP', { revolutMeUrl: 'http://revolut.me/x' }, 'revolutMeUrl'],
    ['une image externe', { weroQrImageUrl: 'https://evil.example/qr.png' }, 'weroQrImageUrl'],
    ['un chemin avec ..', { weroQrImageUrl: '/images/../secret' }, 'weroQrImageUrl'],
    ['un délai nul', { pendingTtlHours: 0 }, 'pendingTtlHours'],
  ])('refuse %s', async (_label, body, field) => {
    const admin = await login()
    const res = await adminApi(admin, '/payment-settings', {
      method: 'PUT',
      body: { weroInstructions: '', pendingTtlHours: 24, ...body },
    })
    expect(res.status).toBe(422)
    expect(res.json.error.fields[field]).toBeDefined()
  })
})

describe('suppression des réservations annulées ou expirées', () => {
  it('supprime une réservation annulée avec ses billets', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000 })
    await reserve(event.id, { quantity: 2 })
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })
    await adminApi(admin, `/reservations/${id}/cancel`, { method: 'POST' })

    const del = await adminApi(admin, `/reservations/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect((await adminApi(admin, '/reservations')).json.total).toBe(0)
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE reservation_id = ?').bind(id).first<{ n: number }>()
    expect(left?.n).toBe(0)
  })

  it('supprime une réservation expirée', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000 })
    await reserve(event.id, { quantity: 1 })
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    await env.DB.prepare(`UPDATE reservations SET payment_status = 'expired', expired_at = ?2 WHERE id = ?1`).bind(id, new Date().toISOString()).run()

    expect((await adminApi(admin, `/reservations/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await adminApi(admin, '/reservations')).json.total).toBe(0)
  })

  it.each(['pending', 'confirmed'])('refuse de supprimer une réservation %s (409)', async (state) => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000 })
    await reserve(event.id, { quantity: 1 })
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    if (state === 'confirmed') await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })
    const del = await adminApi(admin, `/reservations/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)
    expect((await adminApi(admin, '/reservations')).json.total).toBe(1)
  })

  it('renvoie 404 pour une réservation inconnue', async () => {
    const admin = await login()
    expect((await adminApi(admin, '/reservations/inconnue', { method: 'DELETE' })).status).toBe(404)
  })
})
