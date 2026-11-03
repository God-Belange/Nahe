import { describe, expect, it } from 'vitest'
import { buildReminderEmail } from '../worker/services/mailer'
import { adminApi, api, configurePayments, login, makeEvent, reserve, reserveAndConfirm } from './helpers'
import { mailbox } from './mail'

const reminderMails = () => mailbox.sent.filter((m) => m.subject.startsWith('Rappel'))

async function reservationId(session: Awaited<ReturnType<typeof login>>, reference: string) {
  const list = await adminApi(session, `/reservations?q=${reference}`)
  return list.json.items[0].id as string
}

describe('relance de paiement', () => {
  it('envoie un rappel avec un nouveau lien et invalide l\'ancien', async () => {
    await configurePayments()
    const event = await makeEvent({ priceCents: 1250 })
    const { data } = await reserve(event.id, { quantity: 2 })
    const session = await login()
    const id = await reservationId(session, data.reservation.reference)

    const res = await adminApi(session, `/reservations/${id}/remind`, { method: 'POST', body: {} })
    expect(res.status).toBe(200)
    expect(res.json.reminderEmail).toBe('sent')
    expect(res.json.remindedAt).not.toBeNull()

    const [mail] = reminderMails()
    expect(mail!.to[0]!.email).toBe(data.reservation.email)
    expect(mail!.htmlContent).toContain('25,00')
    expect(mail!.htmlContent).toContain('Payer ma réservation')
    const link = mail!.textContent.match(/https:\/\/\S+\/r\/([\w-]+)/)
    expect(link).not.toBeNull()
    expect(mail!.htmlContent).not.toContain(data.accessToken)

    expect((await api(`/reservations/${data.accessToken}`)).status).toBe(404)
    const fresh = await api(`/reservations/${link![1]}`)
    expect(fresh.status).toBe(200)
    expect(fresh.json.reference).toBe(data.reservation.reference)
  })

  it('si l\'envoi échoue, l\'ancien lien reste valide', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const session = await login()
    const id = await reservationId(session, data.reservation.reference)
    mailbox.status = 500
    const res = await adminApi(session, `/reservations/${id}/remind`, { method: 'POST', body: {} })
    expect(res.json.reminderEmail).toBe('failed')
    expect(res.json.remindedAt).toBeNull()
    expect((await api(`/reservations/${data.accessToken}`)).status).toBe(200)
  })

  it('refuse de relancer une réservation confirmée ou annulée', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { id, session } = await reserveAndConfirm(event.id)
    expect((await adminApi(session, `/reservations/${id}/remind`, { method: 'POST', body: {} })).status).toBe(409)

    const { data } = await reserve(event.id)
    const other = await reservationId(session, data.reservation.reference)
    await adminApi(session, `/reservations/${other}/cancel`, { method: 'POST', body: {} })
    expect((await adminApi(session, `/reservations/${other}/remind`, { method: 'POST', body: {} })).status).toBe(409)
    expect(reminderMails()).toHaveLength(0)
  })

  it('exige une session admin', async () => {
    expect((await api('/admin/reservations/x/remind', { method: 'POST', body: {} })).status).toBe(401)
  })

  it('limite le nombre de relances par adresse et par jour', async () => {
    await configurePayments()
    const event = await makeEvent()
    const { data } = await reserve(event.id)
    const session = await login()
    const id = await reservationId(session, data.reservation.reference)
    const results: string[] = []
    for (let i = 0; i < 4; i++) {
      results.push((await adminApi(session, `/reservations/${id}/remind`, { method: 'POST', body: {} })).json.reminderEmail)
    }
    expect(results).toEqual(['sent', 'sent', 'sent', 'quota'])
  })
})

describe('buildReminderEmail', () => {
  it('formate le montant et l\'échéance et échappe les valeurs', () => {
    const mail = buildReminderEmail({
      origin: 'https://nahe.test',
      eventTitle: 'Soirée <b>été</b>',
      eventStartsAt: '2030-06-01T17:00:00.000Z',
      eventEndsAt: null,
      eventLocation: 'Chez Léa',
      eventAddress: '',
      firstName: 'Camille',
      reference: 'NAHE-ABC234',
      accessToken: 'tok',
      amountCents: 1250,
      expiresAt: '2030-05-20T16:00:00.000Z',
    })
    expect(mail.subject).toContain('Soirée <b>été</b>')
    expect(mail.html).not.toContain('<b>été</b>')
    expect(mail.text).toContain('12,50')
    expect(mail.text).toContain('lundi 20 mai à 18h')
    expect(mail.text).toContain('https://nahe.test/r/tok')
  })
})
