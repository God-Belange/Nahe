import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { EventTickets, ScanEvent, ScanOutcome } from '../shared/types'
import {
  adminApi,
  api,
  configurePayments,
  freshIp,
  login,
  makeEvent,
  reserveAndConfirm,
  TEST_SCANNER_PASSWORD,
} from './helpers'

describe('code d\'accès du personnel d\'entrée (rôle scanner)', () => {
  it('le code scanner ouvre une session de rôle « scanner », le mot de passe admin une session « admin »', async () => {
    const scanner = await login(freshIp(), TEST_SCANNER_PASSWORD)
    expect((await api('/admin/session', { cookie: scanner.cookie })).json.role).toBe('scanner')
    const admin = await login()
    expect((await api('/admin/session', { cookie: admin.cookie })).json.role).toBe('admin')
  })

  it('refuse un code inconnu (401)', async () => {
    const res = await api('/admin/session', { method: 'POST', body: { password: 'autre-code-inconnu' } })
    expect(res.status).toBe(401)
  })

  it('le scanner ne peut accéder à aucune route d\'administration (403)', async () => {
    const scanner = await login(freshIp(), TEST_SCANNER_PASSWORD)
    for (const [method, path] of [
      ['GET', '/dashboard'],
      ['GET', '/events'],
      ['POST', '/events'],
      ['GET', '/reservations'],
      ['GET', '/reservations.csv'],
      ['POST', '/reservations/x/confirm'],
      ['GET', '/payment-settings'],
      ['GET', '/email-templates'],
    ] as const) {
      const res = await adminApi(scanner, path, { method, ...(method === 'POST' ? { body: {} } : {}) })
      expect(res.status, `${method} ${path}`).toBe(403)
      expect(res.json.error.code).toBe('forbidden')
    }
  })

  it('le scanner contrôle les billets, sans voir ventes, e-mails ni coordonnées', async () => {
    await configurePayments()
    const event = await makeEvent()
    const admin = await login()
    const { view } = await reserveAndConfirm(event.id, { quantity: 1 }, admin)
    const token = view.tickets[0]!.token
    const scanner = await login(freshIp(), TEST_SCANNER_PASSWORD)

    const events = await adminApi(scanner, '/scan/events')
    expect(events.status).toBe(200)
    const list = events.json as ScanEvent[]
    expect(list.map((e) => e.id)).toContain(event.id)
    expect(Object.keys(list[0]!).sort()).toEqual(['id', 'startsAt', 'status', 'title'])

    const lookup = await adminApi(scanner, `/tickets/lookup?t=${encodeURIComponent(token)}`)
    expect((lookup.json as ScanOutcome).result).toBe('ok')
    const checkIn = await adminApi(scanner, '/tickets/check-in', { method: 'POST', body: { token } })
    expect((checkIn.json as ScanOutcome).result).toBe('admitted')

    const attendance = await adminApi(scanner, `/events/${event.id}/tickets`)
    expect(attendance.status).toBe(200)
    expect((attendance.json as EventTickets).items[0]).not.toHaveProperty('email')
    expect(attendance.text).not.toMatch(/@/)
  })

  it('un brouillon n\'apparaît pas dans la liste du scanner', async () => {
    const draft = await makeEvent({}, false)
    const scanner = await login(freshIp(), TEST_SCANNER_PASSWORD)
    const list = (await adminApi(scanner, '/scan/events')).json as ScanEvent[]
    expect(list.map((e) => e.id)).not.toContain(draft.id)
  })

  it('les routes de contrôle exigent une session et un jeton CSRF', async () => {
    expect((await api('/admin/scan/events')).status).toBe(401)
    expect((await api('/admin/tickets/check-in', { method: 'POST', body: { token: 'x' } })).status).toBe(401)
    const scanner = await login(freshIp(), TEST_SCANNER_PASSWORD)
    const noCsrf = await api('/admin/tickets/check-in', { method: 'POST', body: { token: 'x' }, cookie: scanner.cookie })
    expect(noCsrf.status).toBe(403)
    expect(noCsrf.json.error.code).toBe('bad_csrf')
  })

  it('une session créée sans rôle explicite (avant la migration) est administrateur', async () => {
    await env.DB.prepare(
      "INSERT INTO admin_sessions (id, session_token_hash, csrf_token_hash, expires_at, created_at) VALUES ('legacy', 'h', 'c', '2999-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).run()
    const row = await env.DB.prepare("SELECT role FROM admin_sessions WHERE id = 'legacy'").first<{ role: string }>()
    expect(row?.role).toBe('admin')
  })
})
