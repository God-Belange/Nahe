import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { reservationInputSchema } from '../shared/schemas'
import { getDb } from '../worker/lib/db'
import { savePaymentSettings } from '../worker/services/settings'
import {
  cancelReservation,
  confirmReservation,
  createReservation,
  expireDueReservations,
  getReservationView,
} from '../worker/services/reservations'
import { adminApi, api, configurePayments, freshIp, login, makeEvent, reservationBody, reserve } from './helpers'

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000)

async function remaining(slug: string) {
  return (await api(`/events/${slug}`)).json.remaining as number
}

describe('réservation payante', () => {
  it('crée une réservation en attente avec référence, jeton et instructions Wero', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1250 })
    const res = await reserve(event.id, { quantity: 2, paymentMethod: 'wero' })
    expect(res.status).toBe(201)
    const { reservation, accessToken } = res.data
    expect(reservation.status).toBe('pending')
    expect(reservation.reference).toMatch(/^NAHE-[A-HJKMNP-Z2-9]{6}$/)
    expect(reservation.totalAmountCents).toBe(2500)
    expect(accessToken.length).toBeGreaterThanOrEqual(43)
    expect(reservation.payment).toMatchObject({
      method: 'wero',
      amountCents: 2500,
      reference: reservation.reference,
    })
    expect(reservation.payment?.weroInstructions).toContain('Wero')
    expect(reservation.expiresAt).not.toBeNull()
    expect(await remaining(event.slug)).toBe(8)
  })

  it('construit le lien PayPal.Me avec le montant', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1250 })
    const res = await reserve(event.id, { quantity: 2, paymentMethod: 'paypal' })
    expect(res.data.reservation.payment?.paypalUrl).toBe('https://paypal.me/samtest/25.00EUR')
  })

  it('fournit le lien Revolut.me (sans montant)', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1250 })
    const res = await reserve(event.id, { quantity: 2, paymentMethod: 'revolut' })
    expect(res.status).toBe(201)
    expect(res.data.reservation.payment).toMatchObject({ method: 'revolut', amountCents: 2500, revolutUrl: 'https://revolut.me/samtest' })
  })

  it('ne stocke que le hash du jeton d\'accès', async () => {
    await configurePayments()
    const event = await makeEvent()
    const res = await reserve(event.id)
    const row = await env.DB.prepare('SELECT access_token_hash FROM reservations').first<{ access_token_hash: string }>()
    expect(row?.access_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.access_token_hash).not.toContain(res.data.accessToken)
  })

  it('exige un moyen de paiement configuré pour un événement payant', async () => {
    const event = await makeEvent()
    const none = await reserve(event.id, { paymentMethod: 'wero' })
    expect(none.status).toBe(422)
    expect(none.json.error.code).toBe('payment_method_unavailable')

    await configurePayments()
    const missing = await reserve(event.id, { paymentMethod: null })
    expect(missing.status).toBe(422)
    expect(missing.json.error.fields.paymentMethod).toBeDefined()
  })

  it('valide les champs du formulaire', async () => {
    await configurePayments()
    const event = await makeEvent()
    const res = await api(`/events/${event.id}/reservations`, {
      method: 'POST',
      body: { firstName: '', lastName: 'x'.repeat(81), email: 'pas-un-email', phone: 'abc', quantity: 0 },
    })
    expect(res.status).toBe(422)
    expect(Object.keys(res.json.error.fields)).toEqual(
      expect.arrayContaining(['firstName', 'lastName', 'email', 'phone', 'quantity']),
    )
  })

  it('refuse plusieurs places sans le nom de chaque participant', async () => {
    await configurePayments()
    const event = await makeEvent()
    const res = await api(`/events/${event.id}/reservations`, {
      method: 'POST',
      body: { ...reservationBody({ quantity: 3 }), guests: [{ firstName: 'Ana', lastName: 'Durand' }] },
    })
    expect(res.status).toBe(422)
    expect(Object.keys(res.json.error.fields)).toEqual(['guests.1.firstName', 'guests.1.lastName'])
  })

  it('enregistre les participants et les restitue dans le suivi', async () => {
    await configurePayments()
    const event = await makeEvent()
    const res = await reserve(event.id, { quantity: 2, guests: [{ firstName: 'Ana', lastName: 'Durand' }] })
    expect(res.status).toBe(201)
    expect(res.data.reservation.guests).toEqual([{ firstName: 'Ana', lastName: 'Durand' }])
    const view = await api(`/reservations/${res.data.accessToken}`)
    expect(view.json.guests).toEqual([{ firstName: 'Ana', lastName: 'Durand' }])
  })

  it('normalise le téléphone', async () => {
    await configurePayments()
    const event = await makeEvent()
    await reserve(event.id, { phone: '06 12 34 56 78' })
    const row = await env.DB.prepare('SELECT phone FROM reservations').first<{ phone: string }>()
    expect(row?.phone).toBe('+33612345678')
  })

  it('refuse plus de places que le maximum par réservation', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 50, maxPerBooking: 4 })
    const res = await reserve(event.id, { quantity: 5 })
    expect(res.status).toBe(422)
    expect(res.json.error.fields.quantity).toBeDefined()
  })

  it('refuse un second paiement en attente avec le même e-mail', async () => {
    await configurePayments()
    const event = await makeEvent()
    const first = await reserve(event.id, { email: 'Doublon@Example.com' })
    expect(first.status).toBe(201)
    const second = await reserve(event.id, { email: 'doublon@example.com' })
    expect(second.status).toBe(409)
    expect(second.json.error.code).toBe('duplicate_pending')
  })

  it('une clé d\'idempotence évite la double soumission', async () => {
    await configurePayments()
    const event = await makeEvent()
    const key = crypto.randomUUID()
    const first = await reserve(event.id, { idempotencyKey: key })
    const second = await reserve(event.id, { idempotencyKey: key })
    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(second.json.error.code).toBe('duplicate_submission')
    expect(await remaining(event.slug)).toBe(9)
  })
})

describe('réservation gratuite', () => {
  it('est directement confirmée, sans paiement', async () => {
    const event = await makeEvent({ priceCents: 0 })
    const res = await reserve(event.id, { quantity: 3, paymentMethod: null })
    expect(res.status).toBe(201)
    expect(res.data.reservation.status).toBe('confirmed')
    expect(res.data.reservation.payment).toBeNull()
    expect(res.data.reservation.expiresAt).toBeNull()
    expect(res.data.reservation.totalAmountCents).toBe(0)
    expect(await remaining(event.slug)).toBe(7)
  })
})

describe('capacité', () => {
  it('refuse une réservation qui dépasse les places restantes', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 3 })
    expect((await reserve(event.id, { quantity: 2 })).status).toBe(201)
    const res = await reserve(event.id, { quantity: 2 })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('not_enough_places')
    expect(res.json.error.message).toContain('1 place')
    expect((await reserve(event.id, { quantity: 1 })).status).toBe(201)
    const full = await reserve(event.id, { quantity: 1 })
    expect(full.status).toBe(409)
    expect(await remaining(event.slug)).toBe(0)
    const view = await api(`/events/${event.slug}`)
    expect(view.json.blockReason).toBe('full')
  })

  it('réservations simultanées : aucune surréservation (1 place chacune)', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 5, maxPerBooking: 5 })
    const results = await Promise.all(
      Array.from({ length: 25 }, () => reserve(event.id)),
    )
    const ok = results.filter((r) => r.status === 201)
    const refused = results.filter((r) => r.status === 409)
    expect(ok).toHaveLength(5)
    expect(refused).toHaveLength(20)
    const sum = await env.DB.prepare('SELECT SUM(quantity) AS n FROM reservations').first<{ n: number }>()
    expect(sum?.n).toBe(5)
    expect(await remaining(event.slug)).toBe(0)
  })

  it('réservations simultanées : quantités mixtes sans dépassement', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 10, maxPerBooking: 4 })
    const quantities = [4, 3, 3, 2, 4, 1, 2, 3, 4, 1, 2, 2]
    const results = await Promise.all(quantities.map((q) => reserve(event.id, { quantity: q })))
    const sum = await env.DB.prepare('SELECT SUM(quantity) AS n FROM reservations').first<{ n: number }>()
    expect(sum?.n).toBeLessThanOrEqual(10)
    const booked = results.filter((r) => r.status === 201).reduce((n, r) => n + r.data.reservation.quantity, 0)
    expect(booked).toBe(sum?.n)
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true)
  })

  it('réservations simultanées avec le même e-mail : une seule en attente', async () => {
    await configurePayments()
    const event = await makeEvent()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserve(event.id, { email: 'unique@example.com' })),
    )
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
  })
})

describe('expiration', () => {
  const input = () => reservationInputSchema.parse(reservationBody())

  it('une réservation expirée ne compte plus dans les places et est marquée expired', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 2, maxPerBooking: 2 })
    const created = await createReservation(env, event.id, { ...input(), quantity: 2 }, new Date())
    expect(await remaining(event.slug)).toBe(0)

    const later = hoursFromNow(25)
    const view = await getReservationView(env, created.accessToken, later)
    expect(view.status).toBe('expired')
    expect(view.payment).toBeNull()

    // L'expiration libère les places pour une nouvelle réservation (dans le même état temporel).
    const again = await createReservation(env, event.id, { ...input(), quantity: 2 }, later)
    expect(again.reservation.status).toBe('pending')
    const row = await env.DB
      .prepare("SELECT payment_status, expired_at FROM reservations WHERE reference = ?1")
      .bind(created.reservation.reference)
      .first<{ payment_status: string; expired_at: string }>()
    expect(row?.payment_status).toBe('expired')
    expect(row?.expired_at).not.toBeNull()
  })

  it('le délai suit le paramètre de l\'admin', async () => {
    await configurePayments()
    const admin = await login()
    await adminApi(admin, '/payment-settings', {
      method: 'PUT',
      body: { weroInstructions: 'x', pendingTtlHours: 2 },
    })
    const event = await makeEvent()
    const created = await createReservation(env, event.id, input(), new Date())
    const expires = Date.parse(created.reservation.expiresAt!)
    expect(expires - Date.now()).toBeLessThan(2 * 3_600_000 + 5000)
    expect(expires - Date.now()).toBeGreaterThan(1.9 * 3_600_000)
  })

  it('expireDueReservations ne touche pas les réservations confirmées', async () => {
    const event = await makeEvent({ priceCents: 0 })
    await createReservation(env, event.id, { ...input(), paymentMethod: null }, new Date())
    await expireDueReservations(getDb(env.DB), hoursFromNow(100))
    const row = await env.DB.prepare('SELECT payment_status FROM reservations').first<{ payment_status: string }>()
    expect(row?.payment_status).toBe('confirmed')
  })

  it('l\'admin ne peut pas confirmer une réservation expirée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const created = await createReservation(env, event.id, input(), new Date())
    const id = (await env.DB.prepare('SELECT id FROM reservations').first<{ id: string }>())!.id
    await expect(confirmReservation(env, id, hoursFromNow(30))).rejects.toMatchObject({
      status: 409,
      code: 'invalid_transition',
    })
    expect(created.reservation.status).toBe('pending')
  })
})

describe('confirmation et annulation par l\'admin', () => {
  it('confirmation manuelle : pending → confirmed, places conservées, horodatée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const created = await reserve(event.id, { quantity: 2 })
    const admin = await login()
    const list = await adminApi(admin, '/reservations')
    const id = list.json.items[0].id
    const res = await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('confirmed')
    const row = await env.DB.prepare('SELECT confirmed_at, expires_at FROM reservations').first<any>()
    expect(row.confirmed_at).not.toBeNull()
    expect(row.expires_at).toBeNull()
    expect((await api(`/reservations/${created.data.accessToken}`)).json.status).toBe('confirmed')
    expect(await remaining(event.slug)).toBe(8)
    // pas de double confirmation
    expect((await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })).status).toBe(409)
  })

  it('annulation : libère les places, horodatée, non réactivable', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 4 })
    await reserve(event.id, { quantity: 4 })
    expect(await remaining(event.slug)).toBe(0)
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    const res = await adminApi(admin, `/reservations/${id}/cancel`, { method: 'POST' })
    expect(res.json.status).toBe('cancelled')
    expect(await remaining(event.slug)).toBe(4)
    const row = await env.DB.prepare('SELECT cancelled_at FROM reservations').first<any>()
    expect(row.cancelled_at).not.toBeNull()
    expect((await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })).status).toBe(409)
    expect((await adminApi(admin, `/reservations/${id}/cancel`, { method: 'POST' })).status).toBe(409)
  })

  it('annuler une réservation confirmée est autorisé', async () => {
    const event = await makeEvent({ priceCents: 0 })
    await reserve(event.id, { paymentMethod: null })
    const id = (await env.DB.prepare('SELECT id FROM reservations').first<{ id: string }>())!.id
    const res = await cancelReservation(env, id, new Date())
    expect(res.status).toBe('cancelled')
  })
})

describe('suivi de réservation', () => {
  it('un jeton invalide renvoie 404', async () => {
    expect((await api('/reservations/jeton-invalide')).status).toBe(404)
    expect((await api('/reservations/jeton-invalide/declare-payment', { method: 'POST' })).status).toBe(404)
  })

  it('« J\'ai payé » signale le paiement sans changer le statut', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const res = await api(`/reservations/${data.accessToken}/declare-payment`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('pending')
    expect(res.json.paymentDeclaredAt).not.toBeNull()
    const admin = await login()
    const list = await adminApi(admin, '/reservations')
    expect(list.json.items[0].paymentDeclaredAt).not.toBeNull()
    expect(list.json.items[0].status).toBe('pending')
  })

  it('permet de changer de moyen de paiement tant que la réservation est en attente', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id, { paymentMethod: 'wero' })
    expect(data.reservation.payment?.weroContact).toBe('06 12 34 56 78')
    expect(data.reservation.payment?.availableMethods).toEqual(['wero', 'paypal', 'revolut'])
    await api(`/reservations/${data.accessToken}/declare-payment`, { method: 'POST' })

    const res = await api(`/reservations/${data.accessToken}/payment-method`, {
      method: 'POST',
      body: { paymentMethod: 'paypal' },
    })
    expect(res.status).toBe(200)
    expect(res.json.paymentMethod).toBe('paypal')
    expect(res.json.paymentDeclaredAt).toBeNull()
    expect(res.json.payment.paypalUrl).toContain('paypal.me/samtest')
    const admin = await login()
    expect((await adminApi(admin, '/reservations')).json.items[0].paymentMethod).toBe('paypal')
  })

  it('Wero reste proposé avec seulement un contact, et pas sans rien', async () => {
    const db = getDb(env.DB)
    const base = { weroInstructions: '', weroQrImageUrl: null, weroContact: '06 00 00 00 00', paypalMeUrl: null, revolutMeUrl: null, pendingTtlHours: 24 }
    await savePaymentSettings(db, base, new Date())
    const event = await makeEvent()
    const { data } = await reserve(event.id, { paymentMethod: 'wero' })
    expect(data.reservation.payment?.weroContact).toBe('06 00 00 00 00')
    await savePaymentSettings(db, { ...base, weroContact: null }, new Date())
    expect((await reserve(event.id, { paymentMethod: 'wero' })).status).toBe(422)
  })

  it('refuse un moyen indisponible, inconnu, ou une réservation qui n\'attend plus de paiement', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const change = (token: string, paymentMethod: string) =>
      api(`/reservations/${token}/payment-method`, { method: 'POST', body: { paymentMethod } })
    expect((await change(data.accessToken, 'bitcoin')).status).toBe(422)
    expect((await change('jeton-invalide', 'paypal')).status).toBe(404)

    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })
    expect((await change(data.accessToken, 'paypal')).status).toBe(409)
  })

  it('régénérer le lien invalide l\'ancien jeton', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const admin = await login()
    const id = (await adminApi(admin, '/reservations')).json.items[0].id
    const regen = await adminApi(admin, `/reservations/${id}/regenerate-link`, { method: 'POST' })
    expect(regen.status).toBe(200)
    expect((await api(`/reservations/${data.accessToken}`)).status).toBe(404)
    const fresh = await api(`/reservations/${regen.json.accessToken}`)
    expect(fresh.status).toBe(200)
    expect(fresh.json.reference).toBe(data.reservation.reference)
  })

  it('les pages de suivi sont en no-store', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const res = await api(`/reservations/${data.accessToken}`)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })
})

describe('protection des données', () => {
  it('l\'API publique n\'expose aucune donnée de participant', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 20 })
    await reserve(event.id, { firstName: 'Zoé', lastName: 'Secrète', email: 'zoe.secrete@example.com', phone: '0611223344' })
    const bodies = [
      await api('/events'),
      await api(`/events/${event.slug}`),
      await api(`/invites/${event.inviteToken}`),
    ].map((r) => r.text)
    for (const body of bodies) {
      expect(body).not.toMatch(/Zoé|Secrète|zoe\.secrete|0611223344|\+33611223344/)
    }
  })

  it('limite les réservations par IP (5 par heure)', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 50 })
    const ip = freshIp()
    const attempt = () =>
      api(`/events/${event.id}/reservations`, { method: 'POST', body: reservationBody(), ip })
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(201)
    const blocked = await attempt()
    expect(blocked.status).toBe(429)
    expect(blocked.json.error.code).toBe('rate_limited')
  })
})
