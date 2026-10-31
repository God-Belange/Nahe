import {
  capitalizeFirst,
  DEFAULT_EMAIL_TEMPLATES,
  fillPlaceholders,
  type EmailTemplateContent,
} from '../../shared/email-templates'
import { fullName, parseGuests, ticketHolder } from '../../shared/guests'
import { mapsUrl } from '../../shared/maps'
import type { MailResult } from '../../shared/types'
import { formatEventSchedule } from '../../shared/schedule'
import { sha256Hex } from '../lib/crypto'
import { asc, eq } from 'drizzle-orm'
import { events, reservations, tickets } from '../db/schema'
import { getDb } from '../lib/db'
import { getEmailTemplate } from './email-templates'
import { hitRateLimit } from './rate-limit'
import { issueTickets, signTicket } from './tickets'

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
const DAY_MS = 86_400_000
export const MAIL_GLOBAL_DAILY_CAP = 250
export const MAIL_PER_ADDRESS_DAILY_CAP = 3

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

type Values = Record<string, string>

/** Une ligne du modèle = un paragraphe ; `**gras**` supporté ; les valeurs sont toujours échappées. */
function templateToHtml(
  source: string,
  values: Values,
  { lastMargin, style = '', linkNames = [] }: { lastMargin: number; style?: string; linkNames?: string[] },
): string {
  const lines = source.split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines
    .map((line, i) => {
      const body = fillPlaceholders(escapeHtml(line.trim()), values, (value, name) =>
        linkNames.includes(name)
          ? `<a href="${escapeHtml(value)}" style="color:#5b35d5;word-break:break-all">${escapeHtml(value)}</a>`
          : escapeHtml(value),
      ).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      return `<p style="margin:0 0 ${i === lines.length - 1 ? lastMargin : 8}px${style}">${body}</p>`
    })
    .join('\n')
}

function templateToText(source: string, values: Values): string {
  return fillPlaceholders(source, values).replaceAll('**', '').trim()
}

function templateSubject(template: EmailTemplateContent, fallback: EmailTemplateContent, values: Values): string {
  return capitalizeFirst(fillPlaceholders(template.subject, values)) || capitalizeFirst(fillPlaceholders(fallback.subject, values))
}

export interface TicketsEmailInput {
  origin: string
  eventTitle: string
  eventStartsAt: string
  eventEndsAt: string | null
  eventLocation: string
  eventAddress: string
  firstName: string
  reference: string
  tickets: { seq: number; token: string; holder?: string }[]
}

export function buildTicketsEmail(
  input: TicketsEmailInput,
  template: EmailTemplateContent = DEFAULT_EMAIL_TEMPLATES.tickets,
): { subject: string; html: string; text: string } {
  const total = input.tickets.length
  const when = formatEventSchedule(input.eventStartsAt, input.eventEndsAt)
  const values: Values = {
    prenom: input.firstName,
    evenement: input.eventTitle,
    date: when,
    lieu: input.eventLocation,
    adresse: input.eventAddress,
    reference: input.reference,
    billets: total > 1 ? 'vos billets' : 'votre billet',
    billets_avec_nombre: total > 1 ? `vos ${total} billets` : 'votre billet',
    nb_billets: String(total),
  }
  const subject = templateSubject(template, DEFAULT_EMAIL_TEMPLATES.tickets, values)
  const blocks = input.tickets
    .map((t) => {
      const page = `${input.origin}/t/${t.token}`
      const img = `${input.origin}/api/tickets/${t.token}/qr.png`
      return `<tr><td style="padding:16px 0;border-top:1px solid #e8e0f3;text-align:center">
  <p style="margin:0 0 8px;font-weight:700">Billet ${t.seq} / ${total}${t.holder ? ` · ${escapeHtml(t.holder)}` : ''}</p>
  <a href="${page}"><img src="${img}" width="220" height="220" alt="QR code du billet ${t.seq} sur ${total}" style="display:block;margin:0 auto;border:0"></a>
  <p style="margin:8px 0 0"><a href="${page}" style="color:#5b35d5">Ouvrir le billet ${t.seq}</a></p>
</td></tr>`
    })
    .join('\n')
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#fffaf3;font-family:Arial,Helvetica,sans-serif;color:#1b1230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:24px">
<tr><td><p style="margin:0 0 4px;font-size:22px;font-weight:800">NAHE<span style="color:#ff5c4d">?</span></p>
${templateToHtml(template.intro, values, { lastMargin: 16 })}
<p style="margin:0 0 4px;font-size:18px;font-weight:700">${escapeHtml(input.eventTitle)}</p>
<p style="margin:0 0 2px">${escapeHtml(when)}</p><p style="margin:0 0 ${input.eventAddress ? '2px' : '16px'}">${escapeHtml(input.eventLocation)}</p>${input.eventAddress ? `<p style="margin:0 0 16px;color:#675d82"><a href="${escapeHtml(mapsUrl(input.eventAddress))}" style="color:#675d82">${escapeHtml(input.eventAddress)}</a></p>` : ''}
<p style="margin:0 0 8px;font-size:13px;color:#675d82">Référence ${escapeHtml(input.reference)}</p></td></tr>
${blocks}
<tr><td style="padding-top:16px;border-top:1px solid #e8e0f3;font-size:13px;color:#675d82">
${templateToHtml(template.footer, values, { lastMargin: 0 })}</td></tr>
</table></td></tr></table></body></html>`
  const place = input.eventAddress ? `${input.eventLocation}, ${input.eventAddress}` : input.eventLocation
  const text = [
    templateToText(template.intro, values),
    `${input.eventTitle} — ${when} — ${place}`,
    `Référence ${input.reference}`,
    '',
    ...input.tickets.map((t) => `Billet ${t.seq}/${total}${t.holder ? ` (${t.holder})` : ''} : ${input.origin}/t/${t.token}`),
    '',
    templateToText(template.footer, values),
  ].join('\n')
  return { subject, html, text }
}

export interface TrackingEmailInput {
  origin: string
  eventTitle: string
  eventStartsAt: string
  eventEndsAt: string | null
  eventLocation: string
  eventAddress: string
  firstName: string
  reference: string
  accessToken: string
}

export function buildTrackingEmail(
  input: TrackingEmailInput,
  template: EmailTemplateContent = DEFAULT_EMAIL_TEMPLATES.tracking,
): { subject: string; html: string; text: string } {
  const when = formatEventSchedule(input.eventStartsAt, input.eventEndsAt)
  const url = `${input.origin}/r/${input.accessToken}`
  const place = input.eventAddress ? `${input.eventLocation}, ${input.eventAddress}` : input.eventLocation
  const values: Values = {
    prenom: input.firstName,
    evenement: input.eventTitle,
    date: when,
    lieu: input.eventLocation,
    adresse: input.eventAddress,
    reference: input.reference,
    lien: url,
  }
  const subject = templateSubject(template, DEFAULT_EMAIL_TEMPLATES.tracking, values)
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#fffaf3;font-family:Arial,Helvetica,sans-serif;color:#1b1230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:24px">
<tr><td><p style="margin:0 0 4px;font-size:22px;font-weight:800">NAHE<span style="color:#ff5c4d">?</span></p>
${templateToHtml(template.intro, values, { lastMargin: 16 })}
<p style="margin:0 0 4px;font-size:18px;font-weight:700">${escapeHtml(input.eventTitle)}</p>
<p style="margin:0 0 2px">${escapeHtml(when)}</p><p style="margin:0 0 16px">${escapeHtml(place)}</p>
<p style="margin:0 0 16px;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;background:#5b35d5;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">Suivre ma réservation</a></p>
${templateToHtml(template.footer, values, { lastMargin: 0, style: ';font-size:13px;color:#675d82', linkNames: ['lien'] })}</td></tr>
</table></td></tr></table></body></html>`
  const text = [
    templateToText(template.intro, values),
    `${input.eventTitle} — ${when} — ${place}`,
    '',
    `Suivre ma réservation (payer, retrouver mes billets) : ${url}`,
    '',
    templateToText(template.footer, values),
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

    const guests = parseGuests(row.reservation.guests)
    const message = buildTicketsEmail(
      {
        origin,
        eventTitle: row.event.title,
        eventStartsAt: row.event.startsAt,
        eventEndsAt: row.event.endsAt,
        eventLocation: row.event.location,
        eventAddress: row.event.address,
        firstName: row.reservation.firstName,
        reference: row.reservation.reference,
        tickets: await Promise.all(
          valid.map(async (t) => ({
            seq: t.seq,
            token: await signTicket(env, t.id),
            ...(guests.length > 0 ? { holder: fullName(ticketHolder(row.reservation, guests, t.seq)) } : {}),
          })),
        ),
      },
      await getEmailTemplate(db, 'tickets'),
    )
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

/**
 * Envoie le lien de suivi d'une réservation. Le jeton n'étant stocké que sous forme de hash,
 * cet envoi ne peut avoir lieu qu'à la création. Ne lève jamais d'exception.
 */
export async function sendTrackingEmail(
  env: Env,
  reference: string,
  accessToken: string,
  origin: string,
  now: Date,
): Promise<MailResult> {
  try {
    if (!env.BREVO_API_KEY || !env.MAIL_FROM_EMAIL) return 'not_configured'
    const db = getDb(env.DB)
    const row = await db
      .select({ reservation: reservations, event: events })
      .from(reservations)
      .innerJoin(events, eq(events.id, reservations.eventId))
      .where(eq(reservations.reference, reference))
      .get()
    if (!row || row.reservation.anonymizedAt) return 'failed'

    if ((await hitRateLimit(env.DB, 'mail:global', DAY_MS, now)) > MAIL_GLOBAL_DAILY_CAP) return 'quota'
    const key = `mail:track:${await sha256Hex(`${row.reservation.email}|${row.event.id}`)}`
    if ((await hitRateLimit(env.DB, key, DAY_MS, now)) > MAIL_PER_ADDRESS_DAILY_CAP) return 'quota'

    const message = buildTrackingEmail(
      {
        origin,
        eventTitle: row.event.title,
        eventStartsAt: row.event.startsAt,
        eventEndsAt: row.event.endsAt,
        eventLocation: row.event.location,
        eventAddress: row.event.address,
        firstName: row.reservation.firstName,
        reference: row.reservation.reference,
        accessToken,
      },
      await getEmailTemplate(db, 'tracking'),
    )
    const ok = await postToBrevo(
      env,
      { email: row.reservation.email, name: `${row.reservation.firstName} ${row.reservation.lastName}`.trim() },
      message,
    )
    return ok ? 'sent' : 'failed'
  } catch (err) {
    console.error('Envoi du lien de suivi impossible', err instanceof Error ? err.name : 'unknown')
    return 'failed'
  }
}
