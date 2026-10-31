import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'
import { fullName, parseGuests, ticketHolder } from '../../shared/guests'
import type {
  EventTickets,
  PublicTicket,
  ScanEvent,
  ScanOutcome,
  ScanResult,
  ScanTicketInfo,
  TicketState,
  TicketView,
} from '../../shared/types'
import { events, reservations, tickets } from '../db/schema'
import { hmacBase64Url, timingSafeEqual } from '../lib/crypto'
import { getDb } from '../lib/db'
import { notFound } from '../lib/errors'

type TicketRow = typeof tickets.$inferSelect
type ReservationRow = typeof reservations.$inferSelect
type EventRow = typeof events.$inferSelect

const holderOf = (r: ReservationRow, seq: number) =>
  ticketHolder(r, parseGuests(r.guests), seq)

const SIGNATURE_LENGTH = 32

/** Jeton = identifiant du billet + signature HMAC : réaffichable sans être stocké, infalsifiable. */
export async function signTicket(env: Env, ticketId: string): Promise<string> {
  const signature = (await hmacBase64Url(env.SESSION_SECRET, `ticket:${ticketId}`)).slice(0, SIGNATURE_LENGTH)
  return `${ticketId}.${signature}`
}

/** Retourne l'identifiant du billet si le jeton est authentique, sinon null. */
export async function verifyTicketToken(env: Env, token: string): Promise<string | null> {
  const [id, signature, extra] = token.split('.')
  if (!id || !signature || extra !== undefined || !/^[0-9a-f]{32}$/.test(id)) return null
  const expected = (await hmacBase64Url(env.SESSION_SECRET, `ticket:${id}`)).slice(0, SIGNATURE_LENGTH)
  return timingSafeEqual(signature, expected) ? id : null
}

function ticketState(t: TicketRow, r: ReservationRow, e: EventRow): TicketState {
  if (t.status === 'void' || r.paymentStatus !== 'confirmed' || e.status === 'cancelled') return 'void'
  return t.checkedInAt ? 'used' : 'valid'
}

/**
 * Émet un billet par place pour une réservation confirmée. Idempotent (unicité reservation+seq) :
 * peut être rappelé sans risque pour rattraper une émission interrompue.
 */
export async function issueTickets(env: Env, reservationId: string, now: Date): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (
       SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < (SELECT quantity FROM reservations WHERE id = ?1)
     )
     INSERT OR IGNORE INTO tickets (id, reservation_id, event_id, seq, status, created_at)
     SELECT lower(hex(randomblob(16))), r.id, r.event_id, n.i, 'valid', ?2
     FROM reservations r, n
     WHERE r.id = ?1 AND r.payment_status = 'confirmed'`,
  )
    .bind(reservationId, now.toISOString())
    .run()
}

export async function voidTickets(env: Env, reservationId: string, now: Date): Promise<void> {
  await env.DB.prepare(
    `UPDATE tickets SET status = 'void', voided_at = ?2 WHERE reservation_id = ?1 AND status = 'valid'`,
  )
    .bind(reservationId, now.toISOString())
    .run()
}

export async function ticketViewsFor(
  env: Env,
  reservation: ReservationRow,
  event: EventRow,
): Promise<TicketView[]> {
  if (reservation.paymentStatus !== 'confirmed') return []
  const db = getDb(env.DB)
  let rows = await db
    .select()
    .from(tickets)
    .where(eq(tickets.reservationId, reservation.id))
    .orderBy(asc(tickets.seq))
  if (rows.length < reservation.quantity) {
    await issueTickets(env, reservation.id, new Date())
    rows = await db.select().from(tickets).where(eq(tickets.reservationId, reservation.id)).orderBy(asc(tickets.seq))
  }
  return Promise.all(
    rows.map(async (t) => ({
      seq: t.seq,
      total: reservation.quantity,
      token: await signTicket(env, t.id),
      state: ticketState(t, reservation, event),
      checkedInAt: t.checkedInAt,
    })),
  )
}

async function loadTicket(env: Env, ticketId: string) {
  return getDb(env.DB)
    .select({ ticket: tickets, reservation: reservations, event: events })
    .from(tickets)
    .innerJoin(reservations, eq(reservations.id, tickets.reservationId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .where(eq(tickets.id, ticketId))
    .get()
}

export async function getPublicTicket(env: Env, token: string): Promise<PublicTicket> {
  const id = await verifyTicketToken(env, token)
  const row = id ? await loadTicket(env, id) : undefined
  if (!row) throw notFound('ticket_not_found', 'Billet introuvable.')
  const { ticket, reservation, event } = row
  return {
    seq: ticket.seq,
    total: reservation.quantity,
    holderFirstName: holderOf(reservation, ticket.seq).firstName,
    state: ticketState(ticket, reservation, event),
    token,
    event: {
      title: event.title,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      address: event.address,
      coverImageUrl: event.coverImageUrl,
      status: event.status,
    },
  }
}

function toScanInfo(row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>): ScanTicketInfo {
  const { ticket, reservation, event } = row
  return {
    ticketId: ticket.id,
    seq: ticket.seq,
    total: reservation.quantity,
    holderName: fullName(holderOf(reservation, ticket.seq)),
    reference: reservation.reference,
    eventId: event.id,
    eventTitle: event.title,
    startsAt: event.startsAt,
    checkedInAt: ticket.checkedInAt,
  }
}

async function evaluate(env: Env, ticketId: string, eventId?: string): Promise<ScanOutcome> {
  const row = await loadTicket(env, ticketId)
  if (!row) return { result: 'invalid', ticket: null }
  const info = toScanInfo(row)
  let result: ScanResult
  if (eventId && row.event.id !== eventId) result = 'wrong_event'
  else if (row.event.status === 'cancelled') result = 'event_cancelled'
  else if (ticketState(row.ticket, row.reservation, row.event) === 'void') result = 'void'
  else if (row.ticket.checkedInAt) result = 'already_used'
  else result = 'ok'
  return { result, ticket: info }
}

/** Consultation d'un billet scanné : aucun effet de bord. */
export async function lookupTicket(env: Env, token: string, eventId?: string): Promise<ScanOutcome> {
  const id = await verifyTicketToken(env, token)
  if (!id) return { result: 'invalid', ticket: null }
  return evaluate(env, id, eventId)
}

/**
 * Valide l'entrée. L'unicité repose sur un seul UPDATE conditionnel : de deux scans simultanés,
 * un seul modifie la ligne ; l'autre reçoit « déjà utilisé ».
 */
export async function checkInTicket(
  env: Env,
  ticketId: string,
  now: Date,
  eventId?: string,
): Promise<ScanOutcome> {
  const result = await env.DB.prepare(
    `UPDATE tickets SET checked_in_at = ?1
     WHERE id = ?2 AND status = 'valid' AND checked_in_at IS NULL
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = tickets.reservation_id AND r.payment_status = 'confirmed')
       AND EXISTS (SELECT 1 FROM events e WHERE e.id = tickets.event_id AND e.status <> 'cancelled')
       AND (?3 IS NULL OR tickets.event_id = ?3)`,
  )
    .bind(now.toISOString(), ticketId, eventId ?? null)
    .run()
  const outcome = await evaluate(env, ticketId, eventId)
  if (result.meta.changes === 1 && outcome.ticket) return { result: 'admitted', ticket: outcome.ticket }
  // Aucune ligne modifiée : l'état courant dit pourquoi (jamais « ok »).
  return outcome.result === 'ok' ? { result: 'void', ticket: outcome.ticket } : outcome
}

export async function checkInByToken(env: Env, token: string, now: Date, eventId?: string): Promise<ScanOutcome> {
  const id = await verifyTicketToken(env, token)
  if (!id) return { result: 'invalid', ticket: null }
  return checkInTicket(env, id, now, eventId)
}

export async function undoCheckIn(env: Env, ticketId: string): Promise<ScanOutcome> {
  await env.DB.prepare('UPDATE tickets SET checked_in_at = NULL WHERE id = ?1').bind(ticketId).run()
  return evaluate(env, ticketId)
}

export async function listEventTickets(env: Env, eventId: string): Promise<EventTickets> {
  const db = getDb(env.DB)
  const rows = await db
    .select({ ticket: tickets, reservation: reservations, event: events })
    .from(tickets)
    .innerJoin(reservations, eq(reservations.id, tickets.reservationId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .where(and(eq(tickets.eventId, eventId), sql`${reservations.anonymizedAt} IS NULL`))
    .orderBy(asc(reservations.lastName), asc(reservations.firstName), asc(tickets.seq))
  const items = rows.map(({ ticket, reservation, event }) => ({
    ticketId: ticket.id,
    seq: ticket.seq,
    total: reservation.quantity,
    holderName: fullName(holderOf(reservation, ticket.seq)),
    reference: reservation.reference,
    state: ticketState(ticket, reservation, event),
    checkedInAt: ticket.checkedInAt,
  }))
  return {
    expected: items.filter((t) => t.state !== 'void').length,
    checkedIn: items.filter((t) => t.state === 'used').length,
    items,
  }
}

/** Liste minimale des événements contrôlables (hors brouillons), pour le rôle « scanner ». */
export async function listScanEvents(env: Env): Promise<ScanEvent[]> {
  return getDb(env.DB)
    .select({ id: events.id, title: events.title, startsAt: events.startsAt, status: events.status })
    .from(events)
    .where(ne(events.status, 'draft'))
    .orderBy(desc(events.startsAt))
}
