import { vi } from 'vitest'

export interface SentMail {
  sender: { email: string; name: string }
  to: { email: string; name: string }[]
  subject: string
  htmlContent: string
  textContent: string
}

export const mailbox = {
  sent: [] as SentMail[],
  /** Statut HTTP renvoyé par le faux Brevo (200 = succès). */
  status: 201,
}

export function installMailMock() {
  mailbox.sent.length = 0
  mailbox.status = 201
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://api.brevo.com/')) {
      if (mailbox.status < 300) mailbox.sent.push(JSON.parse(String(init?.body)) as SentMail)
      return new Response('{}', { status: mailbox.status })
    }
    throw new Error(`Appel réseau inattendu pendant les tests : ${url}`)
  })
}

/** E-mails de billets uniquement (hors e-mail du lien de suivi envoyé à la réservation). */
export function ticketMails(): SentMail[] {
  return mailbox.sent.filter((m) => /^Vo(s|tre) billets?/.test(m.subject))
}
