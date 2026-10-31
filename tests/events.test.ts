import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { adminApi, api, configurePayments, daysFromNow, eventInput, login, makeEvent, reserve } from './helpers'
import { createReservation } from '../worker/services/reservations'
import { reservationInputSchema } from '../shared/schemas'

describe('création d\'un événement (admin)', () => {
  it('crée un brouillon avec slug et lien d\'invitation générés', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/events', { method: 'POST', body: eventInput() })
    expect(res.status).toBe(201)
    expect(res.json.status).toBe('draft')
    expect(res.json.slug).toBe('barbecue-chez-sam')
    expect(res.json.inviteToken.length).toBeGreaterThanOrEqual(30)
    expect(res.json.remaining).toBe(10)
  })

  it('génère un slug unique quand le titre est déjà pris', async () => {
    const admin = await login()
    const a = await adminApi(admin, '/events', { method: 'POST', body: eventInput() })
    const b = await adminApi(admin, '/events', { method: 'POST', body: eventInput() })
    expect(b.status).toBe(201)
    expect(b.json.slug).not.toBe(a.json.slug)
    expect(b.json.slug.startsWith('barbecue-chez-sam-')).toBe(true)
  })

  it('refuse un slug explicite déjà utilisé', async () => {
    const admin = await login()
    await adminApi(admin, '/events', { method: 'POST', body: eventInput({ slug: 'fete-ete' }) })
    const res = await adminApi(admin, '/events', { method: 'POST', body: eventInput({ slug: 'fete-ete' }) })
    expect(res.status).toBe(422)
    expect(res.json.error.fields.slug).toBeDefined()
  })

  it('valide les champs (titre vide, prix négatif, capacité nulle, fin avant début)', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ title: ' ', priceCents: -1, capacity: 0, endsAt: daysFromNow(1) }),
    })
    expect(res.status).toBe(422)
    expect(Object.keys(res.json.error.fields)).toEqual(
      expect.arrayContaining(['title', 'priceCents', 'capacity', 'endsAt']),
    )
  })

  it('refuse une date limite postérieure au début et un chemin d\'image invalide', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ bookingDeadline: daysFromNow(31), coverImageUrl: 'https://evil.example/x.png' }),
    })
    expect(res.status).toBe(422)
    expect(res.json.error.fields.bookingDeadline).toBeDefined()
    expect(res.json.error.fields.coverImageUrl).toBeDefined()
  })
})

describe('visibilité', () => {
  it('liste uniquement les événements publics, publiés et à venir', async () => {
    const pub = await makeEvent({ title: 'Public' })
    await makeEvent({ title: 'Privé', visibility: 'private' })
    await makeEvent({ title: 'Brouillon' }, false)
    const cancelled = await makeEvent({ title: 'Annulé' })
    const admin = await login()
    await adminApi(admin, `/events/${cancelled.id}/cancel`, { method: 'POST' })
    await makeEvent({ title: 'Passé', startsAt: daysFromNow(-3), endsAt: null })

    const res = await api('/events')
    expect(res.status).toBe(200)
    expect(res.json.map((e: { id: string }) => e.id)).toEqual([pub.id])
  })

  it('un événement privé est inaccessible par slug mais accessible par jeton d\'invitation', async () => {
    const event = await makeEvent({ visibility: 'private' })
    expect((await api(`/events/${event.slug}`)).status).toBe(404)
    const res = await api(`/invites/${event.inviteToken}`)
    expect(res.status).toBe(200)
    expect(res.json.id).toBe(event.id)
    expect(res.json.inviteToken).toBeUndefined()
  })

  it('un brouillon est inaccessible (slug et invitation)', async () => {
    const event = await makeEvent({}, false)
    expect((await api(`/events/${event.slug}`)).status).toBe(404)
    expect((await api(`/invites/${event.inviteToken}`)).status).toBe(404)
  })

  it('un jeton d\'invitation inconnu renvoie 404', async () => {
    expect((await api('/invites/nimporte-quoi')).status).toBe(404)
  })

  it('l\'API publique ne renvoie jamais le jeton d\'invitation', async () => {
    await makeEvent()
    const res = await api('/events')
    expect(res.text).not.toContain('inviteToken')
  })
})

describe('modification et garde-fous', () => {
  it('refuse de réduire la capacité sous le nombre de places prises', async () => {
    await configurePayments()
    const event = await makeEvent({ capacity: 10 })
    await reserve(event.id, { quantity: 4 })
    const admin = await login()
    const res = await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { capacity: 3 } })
    expect(res.status).toBe(422)
    expect(res.json.error.code).toBe('capacity_below_booked')
    const ok = await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { capacity: 4 } })
    expect(ok.status).toBe(200)
    expect(ok.json.remaining).toBe(0)
  })

  it('changer le prix ne modifie pas le montant des réservations existantes', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1500 })
    const first = await reserve(event.id, { quantity: 2 })
    expect(first.data.reservation.totalAmountCents).toBe(3000)
    const admin = await login()
    await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { priceCents: 2500 } })
    const second = await reserve(event.id, { quantity: 1 })
    expect(second.data.reservation.totalAmountCents).toBe(2500)
    const view = await api(`/reservations/${first.data.accessToken}`)
    expect(view.json.totalAmountCents).toBe(3000)
  })

  it('refuse des dates incohérentes lors d\'une modification partielle', async () => {
    const event = await makeEvent()
    const admin = await login()
    const res = await adminApi(admin, `/events/${event.id}`, {
      method: 'PATCH',
      body: { bookingDeadline: daysFromNow(60) },
    })
    expect(res.status).toBe(422)
    expect(res.json.error.fields.bookingDeadline).toBeDefined()
  })
})

describe('changements d\'état', () => {
  it('publier, fermer, rouvrir, dépublier', async () => {
    const admin = await login()
    const created = await adminApi(admin, '/events', { method: 'POST', body: eventInput() })
    const id = created.json.id
    const act = async (a: string) => (await adminApi(admin, `/events/${id}/${a}`, { method: 'POST' }))
    expect((await act('publish')).json.status).toBe('published')
    expect((await act('close')).json.status).toBe('closed')
    expect((await act('publish')).json.status).toBe('published')
    expect((await act('unpublish')).json.status).toBe('draft')
    expect((await act('close')).status).toBe(409)
  })

  it('annuler un événement liste les remboursements manuels sans toucher aux paiements', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 2000 })
    const r = await reserve(event.id, { quantity: 2 })
    const admin = await login()
    const list = await adminApi(admin, '/reservations')
    const id = list.json.items[0].id
    await adminApi(admin, `/reservations/${id}/confirm`, { method: 'POST' })
    const res = await adminApi(admin, `/events/${event.id}/cancel`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('cancelled')
    expect(res.json.refundsToProcess).toHaveLength(1)
    expect(res.json.refundsToProcess[0].amountCents).toBe(4000)
    const view = await api(`/reservations/${r.data.accessToken}`)
    expect(view.json.status).toBe('confirmed')
    const after = await api(`/events/${event.slug}`)
    expect(after.json.blockReason).toBe('cancelled')
  })

  it('l\'action sur un événement inconnu renvoie 404', async () => {
    const admin = await login()
    expect((await adminApi(admin, '/events/inconnu/publish', { method: 'POST' })).status).toBe(404)
  })
})

describe('règles d\'ouverture des réservations (appliquées par le serveur)', () => {
  const book = async (eventId: string) =>
    createReservation(env, eventId, reservationInputSchema.parse({
      firstName: 'A', lastName: 'B', email: 'a@b.fr', phone: '0612345678', quantity: 1, paymentMethod: 'wero',
    }), new Date())

  it.each([
    ['fermé', { }, 'close', 'booking_closed'],
    ['annulé', { }, 'cancel', 'booking_cancelled'],
  ])('refuse la réservation d\'un événement %s', async (_label, over, action, code) => {
    await configurePayments()
    const event = await makeEvent(over)
    const admin = await login()
    await adminApi(admin, `/events/${event.id}/${action}`, { method: 'POST' })
    await expect(book(event.id)).rejects.toMatchObject({ status: 409, code })
  })

  it('refuse un événement passé et une date limite dépassée', async () => {
    await configurePayments()
    const past = await makeEvent({ startsAt: daysFromNow(-2) })
    await expect(book(past.id)).rejects.toMatchObject({ status: 409, code: 'booking_past' })
    const late = await makeEvent({ bookingDeadline: daysFromNow(-1) })
    await expect(book(late.id)).rejects.toMatchObject({ status: 409, code: 'booking_deadline_passed' })
  })

  it('refuse un brouillon (404)', async () => {
    await configurePayments()
    const draft = await makeEvent({}, false)
    await expect(book(draft.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('modification partielle (PATCH)', () => {
  it('ne modifie que les champs envoyés', async () => {
    const event = await makeEvent({
      description: 'Description à conserver',
      extraInfo: 'Infos à conserver',
      coverImageUrl: '/images/barbecue.svg',
      visibility: 'private',
      maxPerBooking: 3,
      endsAt: daysFromNow(31),
      bookingDeadline: daysFromNow(20),
    })
    const admin = await login()
    const res = await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { capacity: 12 } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({
      capacity: 12,
      description: 'Description à conserver',
      extraInfo: 'Infos à conserver',
      coverImageUrl: '/images/barbecue.svg',
      visibility: 'private',
      maxPerBooking: 3,
      slug: event.slug,
    })
    expect(res.json.endsAt).toBe(event.endsAt)
    expect(res.json.bookingDeadline).toBe(event.bookingDeadline)
  })

  it('permet d\'effacer explicitement un champ facultatif', async () => {
    const event = await makeEvent({ coverImageUrl: '/images/barbecue.svg', bookingDeadline: daysFromNow(20) })
    const admin = await login()
    const res = await adminApi(admin, `/events/${event.id}`, {
      method: 'PATCH',
      body: { coverImageUrl: '', bookingDeadline: null },
    })
    expect(res.json.coverImageUrl).toBeNull()
    expect(res.json.bookingDeadline).toBeNull()
  })
})

describe('adresse du lieu et affichage des places restantes', () => {
  it('valeurs par défaut : adresse vide, compteur affiché', async () => {
    const event = await makeEvent()
    const res = await api(`/events/${event.slug}`)
    expect(res.json).toMatchObject({ location: '12 rue des Lilas, Lille', address: '', showRemaining: true })
  })

  it('crée puis modifie le nom, l\'adresse et l\'option du compteur', async () => {
    const admin = await login()
    const created = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ location: 'Chez Sam', address: ' 12 rue des Lilas, 59000 Lille ', showRemaining: false }),
    })
    expect(created.status).toBe(201)
    expect(created.json).toMatchObject({ location: 'Chez Sam', address: '12 rue des Lilas, 59000 Lille', showRemaining: false })

    const patched = await adminApi(admin, `/events/${created.json.id}`, {
      method: 'PATCH',
      body: { showRemaining: true, address: '' },
    })
    expect(patched.status).toBe(200)
    expect(patched.json).toMatchObject({ location: 'Chez Sam', address: '', showRemaining: true })
  })

  it('refuse une option non booléenne ou une adresse trop longue', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ showRemaining: 'non', address: 'x'.repeat(301) }),
    })
    expect(res.status).toBe(422)
    expect(res.json.error.fields.showRemaining).toBeDefined()
    expect(res.json.error.fields.address).toBeDefined()
  })

  it('expose l\'adresse sur le suivi de réservation', async () => {
    await configurePayments()
    const event = await makeEvent({ location: 'Chez Sam', address: '12 rue des Lilas, Lille' })
    const { data } = await reserve(event.id)
    const tracking = await api(`/reservations/${data.accessToken}`)
    expect(tracking.json.event).toMatchObject({ location: 'Chez Sam', address: '12 rue des Lilas, Lille' })
  })
})
