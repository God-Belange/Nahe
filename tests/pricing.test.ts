import { describe, expect, it } from 'vitest'
import { currentPriceCents } from '../shared/pricing'
import { adminApi, api, configurePayments, daysFromNow, eventInput, login, makeEvent, reserve } from './helpers'

describe('currentPriceCents', () => {
  const event = { priceCents: 1000, doorPriceCents: 1500, doorPriceFrom: '2030-06-01T10:00:00.000Z' }

  it('applique le prix de réservation avant la date d\'effet, le prix sur place ensuite', () => {
    expect(currentPriceCents(event, new Date('2030-06-01T09:59:59.000Z'))).toBe(1000)
    expect(currentPriceCents(event, new Date('2030-06-01T10:00:00.000Z'))).toBe(1500)
  })

  it('reste sur le prix de réservation sans prix sur place', () => {
    expect(currentPriceCents({ ...event, doorPriceCents: null, doorPriceFrom: null }, new Date('2031-01-01'))).toBe(1000)
  })

  it('autorise un prix sur place gratuit', () => {
    expect(currentPriceCents({ ...event, doorPriceCents: 0 }, new Date('2031-01-01'))).toBe(0)
  })
})

describe('prix sur place : validation', () => {
  it('exige le prix et la date ensemble, et une date au plus tard au début', async () => {
    const admin = await login()
    const onlyPrice = await adminApi(admin, '/events', { method: 'POST', body: eventInput({ doorPriceCents: 2000 }) })
    expect(onlyPrice.status).toBe(422)
    expect(Object.keys(onlyPrice.json.error.fields)).toContain('doorPriceFrom')

    const onlyDate = await adminApi(admin, '/events', { method: 'POST', body: eventInput({ doorPriceFrom: daysFromNow(10) }) })
    expect(onlyDate.status).toBe(422)
    expect(Object.keys(onlyDate.json.error.fields)).toContain('doorPriceCents')

    const afterStart = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ doorPriceCents: 2000, doorPriceFrom: daysFromNow(31) }),
    })
    expect(afterStart.status).toBe(422)
    expect(Object.keys(afterStart.json.error.fields)).toContain('doorPriceFrom')

    const ok = await adminApi(admin, '/events', {
      method: 'POST',
      body: eventInput({ doorPriceCents: 2000, doorPriceFrom: daysFromNow(10) }),
    })
    expect(ok.status).toBe(201)
    expect(ok.json).toMatchObject({ priceCents: 1500, basePriceCents: 1500, doorPriceCents: 2000 })
  })

  it('permet de retirer le prix sur place par une modification', async () => {
    const admin = await login()
    const event = await makeEvent({ doorPriceCents: 2000, doorPriceFrom: daysFromNow(10) })
    const res = await adminApi(admin, `/events/${event.id}`, {
      method: 'PATCH',
      body: { doorPriceCents: null, doorPriceFrom: null },
    })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ doorPriceCents: null, doorPriceFrom: null })
  })

  it('refuse un prix sur place laissé seul après une modification partielle', async () => {
    const admin = await login()
    const event = await makeEvent()
    const res = await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { doorPriceCents: 2000 } })
    expect(res.status).toBe(422)
    expect(Object.keys(res.json.error.fields)).toContain('doorPriceFrom')
  })
})

describe('prix sur place : réservation', () => {
  it('facture le prix de réservation avant la date d\'effet', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000, doorPriceCents: 1800, doorPriceFrom: daysFromNow(5) })
    const view = await api(`/events/${event.slug}`)
    expect(view.json).toMatchObject({ priceCents: 1000, basePriceCents: 1000, doorPriceCents: 1800 })
    const res = await reserve(event.id, { quantity: 2 })
    expect(res.status).toBe(201)
    expect(res.data.reservation.totalAmountCents).toBe(2000)
  })

  it('facture le prix sur place une fois la date atteinte, sans toucher aux anciennes réservations', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000, doorPriceCents: 1800, doorPriceFrom: daysFromNow(5) })
    const before = await reserve(event.id, { quantity: 1 })
    expect(before.data.reservation.totalAmountCents).toBe(1000)

    const admin = await login()
    await adminApi(admin, `/events/${event.id}`, { method: 'PATCH', body: { doorPriceFrom: daysFromNow(-1) } })

    const view = await api(`/events/${event.slug}`)
    expect(view.json).toMatchObject({ priceCents: 1800, basePriceCents: 1000 })
    const after = await reserve(event.id, { quantity: 2 })
    expect(after.status).toBe(201)
    expect(after.data.reservation.totalAmountCents).toBe(3600)

    const old = await api(`/reservations/${before.data.accessToken}`)
    expect(old.json.totalAmountCents).toBe(1000)
  })

  it('confirme directement une réservation lorsque le prix sur place est gratuit', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1000, doorPriceCents: 0, doorPriceFrom: daysFromNow(-1) })
    const res = await reserve(event.id, { paymentMethod: null })
    expect(res.status).toBe(201)
    expect(res.data.reservation).toMatchObject({ status: 'confirmed', totalAmountCents: 0 })
  })

  it('exige un moyen de paiement quand seul le prix sur place est payant', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 0, doorPriceCents: 1200, doorPriceFrom: daysFromNow(-1) })
    const res = await reserve(event.id, { paymentMethod: null })
    expect(res.status).toBe(422)
  })
})
