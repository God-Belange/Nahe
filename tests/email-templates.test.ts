import { describe, expect, it } from 'vitest'
import { DEFAULT_EMAIL_TEMPLATES, unknownPlaceholders } from '../shared/email-templates'
import type { EmailTemplateView } from '../shared/types'
import { buildTicketsEmail, buildTrackingEmail } from '../worker/services/mailer'
import { adminApi, api, configurePayments, daysFromNow, login, makeEvent, reserve, reserveAndConfirm } from './helpers'
import { mailbox, ticketMails } from './mail'

const ticketsInput = {
  origin: 'https://nahe.test',
  eventTitle: 'Soirée <b>été</b>',
  eventStartsAt: daysFromNow(10),
  eventEndsAt: null,
  eventLocation: 'Chez Léa',
  eventAddress: '12 rue des Lilas',
  firstName: 'Camille',
  reference: 'NAHE-ABC234',
}

const trackingInput = { ...ticketsInput, accessToken: 'secret-token' }

describe('modèles par défaut', () => {
  it('e-mail des billets : texte d\'origine, singulier et pluriel', () => {
    const one = buildTicketsEmail({ ...ticketsInput, tickets: [{ seq: 1, token: 'a.b' }] })
    expect(one.subject).toBe('Votre billet pour Soirée <b>été</b>')
    expect(one.html).toContain('Bonjour Camille, votre paiement est confirmé. Voici votre billet :')
    expect(one.html).toContain('<strong>Un billet = une seule entrée</strong>')
    const many = buildTicketsEmail({ ...ticketsInput, tickets: [{ seq: 1, token: 'a.b' }, { seq: 2, token: 'c.d' }, { seq: 3, token: 'e.f' }] })
    expect(many.subject).toMatch(/^Vos billets pour/)
    expect(many.html).toContain('Voici vos 3 billets :')
    expect(many.text).toContain('Un billet = une seule entrée')
  })

  it('e-mail de suivi : texte d\'origine avec lien cliquable', () => {
    const mail = buildTrackingEmail(trackingInput)
    const url = 'https://nahe.test/r/secret-token'
    expect(mail.subject).toBe('Votre réservation pour Soirée <b>été</b>')
    expect(mail.html).toContain('Elle est valide une fois le paiement confirmé par l&#39;organisateur.')
    expect(mail.html).toContain(`Lien direct : <a href="${url}" style="color:#5b35d5;word-break:break-all">${url}</a>`)
    expect(mail.html).toContain('Référence NAHE-ABC234. Ce lien vous permet')
    expect(mail.text).toContain(`Suivre ma réservation (payer, retrouver mes billets) : ${url}`)
  })
})

describe('modèle personnalisé', () => {
  const custom = { subject: 'vos places : {{evenement}}', intro: 'Salut **{{prenom}}** !\nÀ {{lieu}}', footer: 'Ref {{reference}}, {{nb_billets}} billet(s)' }

  it('remplace les variables, met en gras et échappe les valeurs', () => {
    const mail = buildTicketsEmail({ ...ticketsInput, firstName: '<script>x</script>', tickets: [{ seq: 1, token: 'a.b' }] }, custom)
    expect(mail.subject).toBe('Vos places : Soirée <b>été</b>')
    expect(mail.html).toContain('<p style="margin:0 0 8px">Salut <strong>&#60;script&#62;x&#60;/script&#62;</strong> !</p>')
    expect(mail.html).toContain('<p style="margin:0 0 16px">À Chez Léa</p>')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('Ref NAHE-ABC234, 1 billet(s)')
    expect(mail.text).toContain('Salut <script>x</script> !\nÀ Chez Léa')
  })

  it('une variable vide ne laisse pas un objet vide', () => {
    const mail = buildTicketsEmail(
      { ...ticketsInput, tickets: [{ seq: 1, token: 'a.b' }] },
      { subject: '{{adresse}}', intro: 'x', footer: '' },
    )
    expect(mail.subject).toBe('12 rue des Lilas')
    const none = buildTicketsEmail(
      { ...ticketsInput, eventAddress: '', tickets: [{ seq: 1, token: 'a.b' }] },
      { subject: '{{adresse}}', intro: 'x', footer: '' },
    )
    expect(none.subject).toBe('Votre billet pour Soirée <b>été</b>')
  })

  it('détecte les variables inconnues', () => {
    expect(unknownPlaceholders('tickets', { subject: '{{lien}}', intro: '{{ prenom }}', footer: '{{nope}}' })).toEqual(['lien', 'nope'])
    expect(unknownPlaceholders('tracking', DEFAULT_EMAIL_TEMPLATES.tracking)).toEqual([])
    expect(unknownPlaceholders('tickets', DEFAULT_EMAIL_TEMPLATES.tickets)).toEqual([])
  })
})

describe('API admin des modèles', () => {
  it('exige une session admin', async () => {
    expect((await api('/admin/email-templates')).status).toBe(401)
    expect((await api('/admin/email-templates/tickets', { method: 'PUT', body: {} })).status).toBe(401)
    expect((await api('/admin/email-templates/tickets', { method: 'DELETE' })).status).toBe(401)
  })

  it('renvoie les textes par défaut tant que rien n\'est personnalisé', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/email-templates')
    expect(res.status).toBe(200)
    const list = res.json as EmailTemplateView[]
    expect(list.map((t) => t.kind)).toEqual(['tickets', 'tracking'])
    for (const t of list) {
      expect(t).toMatchObject({ ...DEFAULT_EMAIL_TEMPLATES[t.kind], customized: false, updatedAt: null })
    }
  })

  it('enregistre, relit puis rétablit le texte par défaut', async () => {
    const admin = await login()
    const body = { subject: 'Hello {{prenom}}', intro: 'Bienvenue', footer: '' }
    const put = await adminApi(admin, '/email-templates/tracking', { method: 'PUT', body })
    expect(put.status).toBe(200)
    expect(put.json).toMatchObject({ kind: 'tracking', ...body, customized: true })
    const list = (await adminApi(admin, '/email-templates')).json as EmailTemplateView[]
    expect(list.find((t) => t.kind === 'tracking')).toMatchObject(body)
    expect(list.find((t) => t.kind === 'tickets')!.customized).toBe(false)

    const del = await adminApi(admin, '/email-templates/tracking', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(del.json).toMatchObject({ ...DEFAULT_EMAIL_TEMPLATES.tracking, customized: false })
  })

  it.each([
    ['une variable inconnue', { subject: 'Salut {{nope}}', intro: 'x', footer: '' }, 'subject'],
    ['une variable d\'un autre modèle', { subject: 'x', intro: 'x', footer: '{{lien}}' }, 'footer'],
    ['un objet vide', { subject: '   ', intro: 'x', footer: '' }, 'subject'],
    ['un objet sur plusieurs lignes', { subject: 'a\nb', intro: 'x', footer: '' }, 'subject'],
    ['une introduction vide', { subject: 'x', intro: '', footer: '' }, 'intro'],
    ['un texte trop long', { subject: 'x', intro: 'x'.repeat(1001), footer: '' }, 'intro'],
  ])('refuse %s', async (_label, body, field) => {
    const admin = await login()
    const res = await adminApi(admin, '/email-templates/tickets', { method: 'PUT', body })
    expect(res.status).toBe(422)
    expect(res.json.error.fields[field]).toBeDefined()
  })

  it('refuse un type de modèle inconnu', async () => {
    const admin = await login()
    const res = await adminApi(admin, '/email-templates/newsletter', { method: 'PUT', body: { subject: 'x', intro: 'x', footer: '' } })
    expect(res.status).toBe(404)
  })
})

describe('envoi avec un modèle personnalisé', () => {
  it('utilise le modèle des billets à la confirmation, puis le défaut après réinitialisation', async () => {
    await configurePayments()
    const event = await makeEvent({ title: 'Gala' })
    const admin = await login()
    await adminApi(admin, '/email-templates/tickets', {
      method: 'PUT',
      body: { subject: 'Places pour {{evenement}} ({{nb_billets}})', intro: 'Coucou {{prenom}}', footer: 'À bientôt' },
    })
    await reserveAndConfirm(event.id, { quantity: 2 }, admin)
    const sent = mailbox.sent.find((m) => m.subject.startsWith('Places pour'))!
    expect(sent.subject).toBe('Places pour Gala (2)')
    expect(sent.htmlContent).toContain('Coucou Camille')
    expect(sent.textContent).toContain('À bientôt')

    await adminApi(admin, '/email-templates/tickets', { method: 'DELETE' })
    mailbox.sent.length = 0
    await reserveAndConfirm(event.id, {}, admin)
    expect(ticketMails()[0]!.subject).toBe('Votre billet pour Gala')
  })

  it('utilise le modèle de suivi à la réservation', async () => {
    await configurePayments()
    const event = await makeEvent({ title: 'Gala' })
    const admin = await login()
    await adminApi(admin, '/email-templates/tracking', {
      method: 'PUT',
      body: { subject: 'Reçu : {{reference}}', intro: 'Merci {{prenom}}', footer: 'Lien : {{lien}}' },
    })
    const created = await reserve(event.id)
    const mail = mailbox.sent.find((m) => m.subject.startsWith('Reçu : '))!
    expect(mail.subject).toBe(`Reçu : ${created.data.reservation.reference}`)
    expect(mail.htmlContent).toContain(`href="https://nahe.test/r/${created.data.accessToken}"`)
  })
})
