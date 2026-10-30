import { env } from 'cloudflare:workers'
import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import type { EventTickets, PublicTicket, ScanOutcome } from '../shared/types'
import { qrMatrix, qrPng } from '../worker/lib/qr'
import { runMaintenance } from '../worker/services/maintenance'
import { buildTicketsEmail, MAIL_GLOBAL_DAILY_CAP, sendTicketsEmail } from '../worker/services/mailer'
import { issueTickets, signTicket, verifyTicketToken } from '../worker/services/tickets'
import { adminApi, api, configurePayments, daysFromNow, login, makeEvent, reserve, reserveAndConfirm } from './helpers'
import { mailbox } from './mail'

const countTickets = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first<{ n: number }>())!.n

const scan = async (admin: Awaited<ReturnType<typeof login>>, token: string, eventId?: string) =>
  (await adminApi(admin, '/tickets/check-in', { method: 'POST', body: { token, ...(eventId ? { eventId } : {}) } })).json as ScanOutcome

describe('émission des billets', () => {
  it('aucun billet avant la confirmation du paiement', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id, { quantity: 2 })
    expect(await countTickets()).toBe(0)
    const view = await api(`/reservations/${data.accessToken}`)
    expect(view.json.status).toBe('pending')
    expect(view.json.tickets).toEqual([])
    expect(mailbox.sent).toHaveLength(0)
  })

  it('une réservation de 4 places produit 4 billets distincts numérotés 1/4 à 4/4', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 20 })
    const { view } = await reserveAndConfirm(event.id, { quantity: 4 })
    expect(view.tickets).toHaveLength(4)
    expect(view.tickets.map((t) => t.seq)).toEqual([1, 2, 3, 4])
    expect(new Set(view.tickets.map((t) => t.token)).size).toBe(4)
    expect(view.tickets.every((t) => t.total === 4 && t.state === 'valid' && t.checkedInAt === null)).toBe(true)
    expect(await countTickets()).toBe(4)
  })

  it('un événement gratuit émet les billets immédiatement', async () => {
    const event = await makeEvent({ priceCents: 0 })
    const { data } = await reserve(event.id, { quantity: 3, paymentMethod: null })
    expect(data.reservation.status).toBe('confirmed')
    expect(data.reservation.tickets).toHaveLength(3)
    expect(mailbox.sent).toHaveLength(1)
  })

  it('l\'émission est idempotente et se rattrape toute seule', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id, accessToken } = await reserveAndConfirm(event.id, { quantity: 3 })
    await issueTickets(env, id, new Date())
    await issueTickets(env, id, new Date())
    expect(await countTickets()).toBe(3)
    await env.DB.prepare('DELETE FROM tickets WHERE seq = 2').run()
    const view = await api(`/reservations/${accessToken}`)
    expect(view.json.tickets.map((t: { seq: number }) => t.seq)).toEqual([1, 2, 3])
    expect(await countTickets()).toBe(3)
  })

  it('l\'annulation de la réservation annule tous les billets', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id, view, session } = await reserveAndConfirm(event.id, { quantity: 2 })
    await adminApi(session, `/reservations/${id}/cancel`, { method: 'POST' })
    const rows = await env.DB.prepare('SELECT status FROM tickets').all<{ status: string }>()
    expect(rows.results.every((r) => r.status === 'void')).toBe(true)
    const outcome = await scan(session, view.tickets[0]!.token)
    expect(outcome.result).toBe('void')
  })
})

describe('jetons', () => {
  it('rejette un jeton falsifié, tronqué, d\'un autre billet ou arbitraire', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id, { quantity: 2 })
    const [a, b] = view.tickets
    const [idA, sigA] = a!.token.split('.') as [string, string]
    const [idB] = b!.token.split('.') as [string]
    const forged = [
      `${idA}.${sigA.slice(0, -1)}${sigA.endsWith('A') ? 'B' : 'A'}`,
      `${idB}.${sigA}`,
      `${idA}.`,
      idA,
      `${idA}.${sigA}.extra`,
      '0'.repeat(32) + '.' + sigA,
      "'; DROP TABLE tickets;--",
      '',
    ]
    for (const token of forged) {
      expect(await verifyTicketToken(env, token), token).toBeNull()
    }
    for (const token of forged.filter(Boolean)) {
      const res = await adminApi(session, `/tickets/lookup?t=${encodeURIComponent(token)}`)
      expect(res.json.result).toBe('invalid')
    }
    expect(await verifyTicketToken(env, a!.token)).toBe(idA)
    expect(await countTickets()).toBe(2)
  })

  it('un jeton signé avec un autre secret est refusé', async () => {
    const id = 'a'.repeat(32)
    const token = await signTicket(env, id)
    expect(await verifyTicketToken(env, token)).toBe(id)
    expect(await verifyTicketToken({ ...env, SESSION_SECRET: 'autre-secret' }, token)).toBeNull()
  })
})

describe('contrôle d\'entrée', () => {
  it('la consultation n\'a aucun effet de bord', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id)
    const token = view.tickets[0]!.token
    for (let i = 0; i < 3; i++) {
      const res = await adminApi(session, `/tickets/lookup?t=${encodeURIComponent(token)}`)
      expect(res.json.result).toBe('ok')
      expect(res.json.ticket).toMatchObject({ seq: 1, total: 1, eventTitle: event.title })
    }
    const row = await env.DB.prepare('SELECT checked_in_at FROM tickets').first<{ checked_in_at: string | null }>()
    expect(row?.checked_in_at).toBeNull()
  })

  it('un billet n\'entre qu\'une fois ; chaque billet d\'un groupe entre une fois', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 20 })
    const { view, session } = await reserveAndConfirm(event.id, { quantity: 3 })
    const [t1, t2, t3] = view.tickets.map((t) => t.token) as [string, string, string]

    const first = await scan(session, t1)
    expect(first.result).toBe('admitted')
    expect(first.ticket).toMatchObject({ seq: 1, total: 3 })
    const again = await scan(session, t1)
    expect(again.result).toBe('already_used')
    expect(again.ticket?.checkedInAt).not.toBeNull()
    expect((await scan(session, t2)).result).toBe('admitted')
    expect((await scan(session, t3)).result).toBe('admitted')
    expect((await scan(session, t2)).result).toBe('already_used')

    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE checked_in_at IS NOT NULL').first<{ n: number }>()
    expect(used?.n).toBe(3)
  })

  it('double scan simultané : une seule entrée acceptée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id)
    const token = view.tickets[0]!.token
    const results = await Promise.all(Array.from({ length: 20 }, () => scan(session, token)))
    expect(results.filter((r) => r.result === 'admitted')).toHaveLength(1)
    expect(results.filter((r) => r.result === 'already_used')).toHaveLength(19)
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE checked_in_at IS NOT NULL').first<{ n: number }>()
    expect(row?.n).toBe(1)
  })

  it('double validation manuelle simultanée (par identifiant) : une seule entrée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { session } = await reserveAndConfirm(event.id)
    const list = (await adminApi(session, `/events/${event.id}/tickets`)).json as EventTickets
    const id = list.items[0]!.ticketId
    const results = await Promise.all(
      Array.from({ length: 10 }, () => adminApi(session, `/tickets/${id}/check-in`, { method: 'POST' })),
    )
    expect(results.filter((r) => r.json.result === 'admitted')).toHaveLength(1)
  })

  it('refuse le billet d\'un autre événement quand un événement est sélectionné', async () => {
    await configurePayments()
    const a = await makeEvent({ title: 'Soirée A' })
    const b = await makeEvent({ title: 'Soirée B' })
    const { view, session } = await reserveAndConfirm(a.id)
    const token = view.tickets[0]!.token
    expect((await scan(session, token, b.id)).result).toBe('wrong_event')
    const row = await env.DB.prepare('SELECT checked_in_at FROM tickets').first<{ checked_in_at: string | null }>()
    expect(row?.checked_in_at).toBeNull()
    expect((await scan(session, token, a.id)).result).toBe('admitted')
  })

  it('refuse toute entrée si l\'événement est annulé', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id)
    await adminApi(session, `/events/${event.id}/cancel`, { method: 'POST' })
    expect((await scan(session, view.tickets[0]!.token)).result).toBe('event_cancelled')
    const refreshed = await api(`/tickets/${view.tickets[0]!.token}`)
    expect(refreshed.json.state).toBe('void')
  })

  it('refuse un billet dont la réservation a été annulée même si le billet est resté « valid »', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id, view, session } = await reserveAndConfirm(event.id)
    await env.DB.prepare("UPDATE reservations SET payment_status = 'cancelled' WHERE id = ?1").bind(id).run()
    expect((await scan(session, view.tickets[0]!.token)).result).toBe('void')
  })

  it('permet d\'annuler une validation faite par erreur, puis de revalider', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id)
    const token = view.tickets[0]!.token
    const first = await scan(session, token)
    const undo = await adminApi(session, `/tickets/${first.ticket!.ticketId}/undo-check-in`, { method: 'POST' })
    expect(undo.json.result).toBe('ok')
    expect((await scan(session, token)).result).toBe('admitted')
  })

  it('liste les billets de l\'événement avec le compteur entrés / attendus', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 20 })
    const { view, session } = await reserveAndConfirm(event.id, { quantity: 3, firstName: 'Zoé', lastName: 'Martin' })
    await reserve(event.id, { quantity: 2 }) // en attente : pas de billets
    await scan(session, view.tickets[0]!.token)
    const res = (await adminApi(session, `/events/${event.id}/tickets`)).json as EventTickets
    expect(res.expected).toBe(3)
    expect(res.checkedIn).toBe(1)
    expect(res.items.map((i) => i.state)).toEqual(['used', 'valid', 'valid'])
    expect(res.items[0]).toMatchObject({ holderName: 'Zoé Martin', seq: 1, total: 3 })
    expect(res.items.map((i) => i.holderName)).toEqual(['Zoé Martin', 'Invité2 Durand', 'Invité3 Durand'])
  })

  it('les routes billets exigent une session admin et un jeton CSRF', async () => {
    expect((await api('/admin/tickets/lookup?t=x')).status).toBe(401)
    expect((await api('/admin/tickets/check-in', { method: 'POST', body: { token: 'x' } })).status).toBe(401)
    expect((await api('/admin/events/x/tickets')).status).toBe(401)
    expect((await api('/admin/reservations/x/resend-tickets', { method: 'POST', body: {} })).status).toBe(401)
    const admin = await login()
    const noCsrf = await api('/admin/tickets/check-in', { method: 'POST', body: { token: 'x' }, cookie: admin.cookie })
    expect(noCsrf.status).toBe(403)
  })
})

describe('pages et images publiques du billet', () => {
  it('la page billet n\'expose que le prénom, le numéro et l\'événement', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 10 })
    const { view } = await reserveAndConfirm(event.id, { quantity: 2, firstName: 'Léa', lastName: 'Confidentielle', email: 'lea.secret@example.com', phone: '0611223344', guests: [{ firstName: 'Noé', lastName: 'Secret' }] })
    const res = await api(`/tickets/${view.tickets[1]!.token}`)
    expect((res.json as PublicTicket).holderFirstName).toBe('Noé')
    expect((await api(`/tickets/${view.tickets[0]!.token}`)).json.holderFirstName).toBe('Léa')
    expect(res.status).toBe(200)
    const body = res.json as PublicTicket
    expect(body).toMatchObject({ seq: 2, total: 2, state: 'valid' })
    expect(res.text).not.toMatch(/Confidentielle|lea\.secret|0611223344|\+33611223344/)
    expect((await api('/tickets/jeton-invalide')).status).toBe(404)
  })

  it('sert un PNG valide, uniquement pour un jeton authentique', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view } = await reserveAndConfirm(event.id)
    const token = view.tickets[0]!.token
    const res = await api(`/tickets/${token}/qr.png`, {})
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toContain('private')
    expect((await api(`/tickets/${token.slice(0, -2)}xx/qr.png`)).status).toBe(404)
  })
})

describe('QR code', () => {
  const payload = 'https://nahe.example.workers.dev/admin/scan?t=' + 'a'.repeat(32) + '.' + 'B'.repeat(32)

  it('la matrice se décode (aller-retour encodage → décodage)', () => {
    const matrix = qrMatrix(payload)
    const scale = 4
    const quiet = 4
    const size = (matrix.length + quiet * 2) * scale
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255)
    for (let y = 0; y < matrix.length * scale; y++) {
      for (let x = 0; x < matrix.length * scale; x++) {
        if (matrix[Math.floor(y / scale)]![Math.floor(x / scale)]) {
          const i = ((y + quiet * scale) * size + x + quiet * scale) * 4
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
        }
      }
    }
    expect(jsQR(rgba, size, size)?.data).toBe(payload)
  })

  it('le PNG généré est structurellement valide et se décode', () => {
    const png = qrPng(payload)
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    expect(png[24]).toBe(1) // 1 bit par pixel
    expect(width).toBe(height)

    // Retrouve IDAT, retire l'en-tête zlib et les blocs « stockés », vérifie CRC et Adler-32.
    let offset = 8
    const idat: number[] = []
    const crc = (bytes: Uint8Array) => {
      let c = 0xffffffff
      for (const b of bytes) {
        c ^= b
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      return (c ^ 0xffffffff) >>> 0
    }
    while (offset < png.length) {
      const len = view.getUint32(offset)
      const type = String.fromCharCode(...png.slice(offset + 4, offset + 8))
      const data = png.slice(offset + 8, offset + 8 + len)
      expect(view.getUint32(offset + 8 + len)).toBe(crc(png.slice(offset + 4, offset + 8 + len)))
      if (type === 'IDAT') idat.push(...data)
      offset += 12 + len
    }
    const z = Uint8Array.from(idat)
    expect([z[0], z[1]]).toEqual([0x78, 0x01])
    const raw: number[] = []
    let p = 2
    for (;;) {
      const final = z[p]!
      const len = z[p + 1]! | (z[p + 2]! << 8)
      expect(z[p + 3]! | (z[p + 4]! << 8)).toBe(~len & 0xffff)
      for (let i = 0; i < len; i++) raw.push(z[p + 5 + i]!)
      p += 5 + len
      if (final) break
    }
    let a = 1
    let b = 0
    for (const x of raw) {
      a = (a + x) % 65521
      b = (b + a) % 65521
    }
    expect(new DataView(z.buffer).getUint32(p)).toBe(((b << 16) | a) >>> 0)

    const rowBytes = Math.ceil(width / 8)
    expect(raw.length).toBe((rowBytes + 1) * height)
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (raw[y * (rowBytes + 1) + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = bit ? 255 : 0
        rgba[i + 3] = 255
      }
    }
    expect(jsQR(rgba, width, height)?.data).toBe(payload)
  })
})

describe('e-mail des billets', () => {
  it('envoie à la confirmation un seul e-mail contenant un QR par billet, sans lien de suivi', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 10 })
    const { view, confirm, accessToken } = await reserveAndConfirm(event.id, { quantity: 3, firstName: 'Camille', email: 'camille@example.com' })
    expect(confirm.status).toBe(200)
    expect(confirm.json.ticketsEmail).toBe('sent')
    expect(confirm.json.ticketsEmailedAt).not.toBeNull()
    expect(mailbox.sent).toHaveLength(1)
    const mail = mailbox.sent[0]!
    expect(mail.to[0]!.email).toBe('camille@example.com')
    expect(mail.sender.email).toBe('billets@nahe.test')
    expect(mail.subject).toContain('Vos billets')
    for (const t of view.tickets) {
      expect(mail.htmlContent).toContain(`/t/${t.token}`)
      expect(mail.htmlContent).toContain(`/api/tickets/${t.token}/qr.png`)
      expect(mail.textContent).toContain(`/t/${t.token}`)
    }
    expect(mail.htmlContent.match(/qr\.png/g)).toHaveLength(3)
    expect(mail.htmlContent).not.toContain(accessToken)
    expect(mail.textContent).not.toContain(accessToken)
    expect(mail.htmlContent).toContain('Billet 3 / 3')
  })

  it('un échec du fournisseur ne remet pas en cause la confirmation ; le renvoi fonctionne', async () => {
    await configurePayments()
    const event = await makeEvent()
    mailbox.status = 500
    const { confirm, id, view, session } = await reserveAndConfirm(event.id, { quantity: 2 })
    expect(confirm.status).toBe(200)
    expect(confirm.json.status).toBe('confirmed')
    expect(confirm.json.ticketsEmail).toBe('failed')
    expect(confirm.json.ticketsEmailedAt).toBeNull()
    expect(view.status).toBe('confirmed')
    expect(view.tickets).toHaveLength(2)

    mailbox.status = 201
    const resend = await adminApi(session, `/reservations/${id}/resend-tickets`, { method: 'POST', body: {} })
    expect(resend.json.ticketsEmail).toBe('sent')
    expect(resend.json.ticketsEmailedAt).not.toBeNull()
    expect(mailbox.sent).toHaveLength(1)
  })

  it('refuse de renvoyer les billets d\'une réservation non confirmée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const session = await login()
    const list = await adminApi(session, `/reservations?q=${data.reservation.reference}`)
    const res = await adminApi(session, `/reservations/${list.json.items[0].id}/resend-tickets`, { method: 'POST', body: {} })
    expect(res.status).toBe(409)
    expect(mailbox.sent).toHaveLength(0)
  })

  it('sans configuration du fournisseur, aucun e-mail et aucune erreur', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id } = await reserveAndConfirm(event.id)
    mailbox.sent.length = 0
    const result = await sendTicketsEmail({ ...env, BREVO_API_KEY: undefined }, id, 'https://nahe.test', new Date())
    expect(result).toBe('not_configured')
    expect(mailbox.sent).toHaveLength(0)
  })

  it('plafonne les envois par adresse et par événement (3 / 24 h), sauf renvoi admin', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id } = await reserveAndConfirm(event.id, { email: 'plafond@example.com' })
    const results: string[] = []
    for (let i = 0; i < 4; i++) results.push(await sendTicketsEmail(env, id, 'https://nahe.test', new Date()))
    // 1 envoi à la confirmation + 2 permis + le 4e refusé
    expect(results).toEqual(['sent', 'sent', 'quota', 'quota'])
    expect(await sendTicketsEmail(env, id, 'https://nahe.test', new Date(), { force: true })).toBe('sent')
  })

  it('plafonne les envois globaux quotidiens', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id } = await reserveAndConfirm(event.id)
    const day = 86_400_000
    const windowStart = Math.floor(Date.now() / day) * day
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES ('mail:global', ?1, ?2)")
      .bind(windowStart, MAIL_GLOBAL_DAILY_CAP)
      .run()
    expect(await sendTicketsEmail(env, id, 'https://nahe.test', new Date(), { force: true })).toBe('quota')
  })

  it('échappe le contenu saisi par les invités dans le HTML', () => {
    const { html } = buildTicketsEmail({
      origin: 'https://nahe.test',
      eventTitle: '<img src=x onerror=alert(1)>',
      eventStartsAt: daysFromNow(10),
      eventEndsAt: null,
      eventLocation: 'Salle "Z" & <b>Co</b>',
      eventAddress: '1 rue <i>X</i>',
      firstName: '<script>alert(1)</script>',
      reference: 'NAHE-ABC234',
      tickets: [{ seq: 1, token: 'abc.def' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>Co</b>')
    expect(html).not.toContain('<i>X</i>')
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&#38;query=1%20rue%20%3Ci%3EX%3C%2Fi%3E"')
    expect(html).toContain('&#60;script&#62;')
  })

  it('utilise le singulier pour un seul billet', async () => {
    await configurePayments()
    const event = await makeEvent()
    await reserveAndConfirm(event.id)
    expect(mailbox.sent[0]!.subject).toMatch(/^Votre billet pour/)
  })
})

describe('conservation des données', () => {
  it('l\'anonymisation rend les billets inutilisables', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { view, session } = await reserveAndConfirm(event.id)
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await env.DB.prepare('UPDATE events SET starts_at = ?1 WHERE id = ?2').bind(longAgo, event.id).run()
    await runMaintenance(env, new Date())
    expect((await scan(session, view.tickets[0]!.token)).result).toBe('void')
    const list = (await adminApi(session, `/events/${event.id}/tickets`)).json as EventTickets
    expect(list.items).toHaveLength(0)
  })
})
