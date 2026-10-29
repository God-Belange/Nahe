import type { MailResult } from '../../shared/types'
import { formatEventDateForMail } from '../lib/mail-format'
import { sha256Hex } from '../lib/crypto'
import { asc, eq } from 'drizzle-orm'
import { events, reservations, tickets } from '../db/schema'
import { getDb } from '../lib/db'
import { hitRateLimit } from './rate-limit'
import { issueTickets, signTicket } from './tickets'

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
const DAY_MS = 86_400_000
export const MAIL_GLOBAL_DAILY_CAP = 250
export const MAIL_PER_ADDRESS_DAILY_CAP = 3

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export interface TicketsEmailInput {
  origin: string
  eventTitle: string
  eventStartsAt: string
  eventLocation: string
  firstName: string
  reference: string
  tickets: { seq: number; token: string }[]
}

export function buildTicketsEmail(input: TicketsEmailInput): { subject: string; html: string; text: string } {
  const total = input.tickets.length
  const when = formatEventDateForMail(input.eventStartsAt)
  const subject = `${total > 1 ? 'Vos billets' : 'Votre billet'} pour ${input.eventTitle}`
  const blocks = input.tickets
    .map((t) => {
      const page = `${input.origin}/t/${t.token}`
      const img = `${input.origin}/api/tickets/${t.token}/qr.png`
      return `<tr><td style="padding:16px 0;border-top:1px solid #e8e0f3;text-align:center">
  <p style="margin:0 0 8px;font-weight:700">Billet ${t.seq} / ${total}</p>
  <a href="${page}"><img src="${img}" width="220" height="220" alt="QR code du billet ${t.seq} sur ${total}" style="display:block;margin:0 auto;border:0"></a>
  <p style="margin:8px 0 0"><a href="${page}" style="color:#5b35d5">Ouvrir le billet ${t.seq}</a></p>
</td></tr>`
    })
    .join('\n')
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#fffaf3;font-family:Arial,Helvetica,sans-serif;color:#1b1230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:24px">
<tr><td><p style="margin:0 0 4px;font-size:22px;font-weight:800">NAHE<span style="color:#ff5c4d">?</span></p>
<p style="margin:0 0 16px">Bonjour ${escapeHtml(input.firstName)}, votre paiement est confirmé. Voici ${total > 1 ? `vos ${total} billets` : 'votre billet'} :</p>
<p style="margin:0 0 4px;font-size:18px;font-weight:700">${escapeHtml(input.eventTitle)}</p>
<p style="margin:0 0 2px">${escapeHtml(when)}</p><p style="margin:0 0 16px">${escapeHtml(input.eventLocation)}</p>
<p style="margin:0 0 8px;font-size:13px;color:#675d82">Référence ${escapeHtml(input.reference)}</p></td></tr>
${blocks}
<tr><td style="padding-top:16px;border-top:1px solid #e8e0f3;font-size:13px;color:#675d82">
Présentez le QR code à l'entrée (capture d'écran acceptée). <strong>Un billet = une seule entrée</strong> : chaque personne doit avoir le sien. Si les images ne s'affichent pas, ouvrez les liens ci-dessus.</td></tr>
</table></td></tr></table></body></html>`
  const text = [
    `Bonjour ${input.firstName}, votre paiement est confirmé.`,
    `${input.eventTitle} — ${when} — ${input.eventLocation}`,
    `Référence ${input.reference}`,
    '',
    ...input.tickets.map((t) => `Billet ${t.seq}/${total} : ${input.origin}/t/${t.token}`),
    '',
    "Présentez le QR code à l'entrée. Un billet = une seule entrée.",
  ].join('\n')
  return { subject, html, text }
}

async function postToBrevo(
  env: Env,
  to: { email: string; name: string },
  message: { subject: string; html: string; text: string },
): Promise<boolean> {
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME || 'Nahe' },
        to: [to],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    })
    if (!res.ok) console.error(`Brevo a répondu ${res.status}`)
    return res.ok
  } catch {
    console.error('Appel Brevo impossible')
    return false
  }
}

/**
 * Envoie l'e-mail des billets d'une réservation confirmée. Ne lève jamais d'exception :
 * un échec d'envoi ne doit pas remettre en cause la confirmation.
 */
export async function sendTicketsEmail(
  env: Env,
  reservationId: string,
  origin: string,
  now: Date,
  options: { force?: boolean } = {},
): Promise<MailResult> {
  try {
    if (!env.BREVO_API_KEY || !env.MAIL_FROM_EMAIL) return 'not_configured'
    const db = getDb(env.DB)
    const row = await db
      .select({ reservation: reservations, event: events })
      .from(reservations)
      .innerJoin(events, eq(events.id, reservations.eventId))
      .where(eq(reservations.id, reservationId))
      .get()
    if (!row || row.reservation.paymentStatus !== 'confirmed' || row.reservation.anonymizedAt) return 'failed'

    await issueTickets(env, reservationId, now)
    const rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.reservationId, reservationId))
      .orderBy(asc(tickets.seq))
    const valid = rows.filter((t) => t.status === 'valid')
    if (valid.length === 0) return 'failed'

    if ((await hitRateLimit(env.DB, 'mail:global', DAY_MS, now)) > MAIL_GLOBAL_DAILY_CAP) return 'quota'
    if (!options.force) {
      const key = `mail:addr:${await sha256Hex(`${row.reservation.email}|${row.event.id}`)}`
      if ((await hitRateLimit(env.DB, key, DAY_MS, now)) > MAIL_PER_ADDRESS_DAILY_CAP) return 'quota'
    }

    const message = buildTicketsEmail({
      origin,
      eventTitle: row.event.title,
      eventStartsAt: row.event.startsAt,
      eventLocation: row.event.location,
      firstName: row.reservation.firstName,
      reference: row.reservation.reference,
      tickets: await Promise.all(valid.map(async (t) => ({ seq: t.seq, token: await signTicket(env, t.id) }))),
    })
    const ok = await postToBrevo(
      env,
      { email: row.reservation.email, name: `${row.reservation.firstName} ${row.reservation.lastName}`.trim() },
      message,
    )
    if (!ok) return 'failed'
    await db
      .update(reservations)
      .set({ ticketsEmailedAt: now.toISOString() })
      .where(eq(reservations.id, reservationId))
    return 'sent'
  } catch (err) {
    console.error('Envoi des billets impossible', err instanceof Error ? err.name : 'unknown')
    return 'failed'
  }
}
