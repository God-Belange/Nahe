import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { bookingBlockReason, BLOCK_REASON_MESSAGES, addHours } from '../../shared/booking'
import type { PaymentMethod, ReservationStatus } from '../../shared/constants'
import { parseGuests } from '../../shared/guests'
import { currentPriceCents, currentPriceSql } from '../../shared/pricing'
import { buildPaypalLink } from '../../shared/paypal'
import { buildRevolutLink } from '../../shared/revolut'
import type { ReservationInput } from '../../shared/schemas'
import type {
  AdminReservation,
  AdminReservationsPage,
  CreatedReservation,
  PaymentSettings,
  ReservationView,
  TicketView,
} from '../../shared/types'
import { events, reservations } from '../db/schema'
import { randomId, randomReference, randomToken, sha256Hex } from '../lib/crypto'
import { getDb, type Db } from '../lib/db'
import { ApiError, conflict, notFound } from '../lib/errors'
import { isUniqueViolation } from '../lib/sql-errors'
import { availablePaymentMethods, getPaymentSettings } from './settings'
import { issueTickets, ticketViewsFor, voidTickets } from './tickets'

type ReservationRow = typeof reservations.$inferSelect
type EventRow = typeof events.$inferSelect

/** Marque `expired` les réservations en attente dont le délai est dépassé (libère leurs places). */
export async function expireDueReservations(db: Db, now: Date, eventId?: string): Promise<void> {
  const nowIso = now.toISOString()
  const conditions: SQL[] = [
    eq(reservations.paymentStatus, 'pending'),
    sql`${reservations.expiresAt} <= ${nowIso}`,
  ]
  if (eventId) conditions.push(eq(reservations.eventId, eventId))
  await db
    .update(reservations)
    .set({ paymentStatus: 'expired', expiredAt: sql`${reservations.expiresAt}` })
    .where(and(...conditions))
}

function effectiveStatus(row: ReservationRow, now: Date): ReservationStatus {
  if (row.paymentStatus === 'pending' && row.expiresAt !== null && row.expiresAt <= now.toISOString()) {
    return 'expired'
  }
  return row.paymentStatus
}

function buildView(
  row: ReservationRow,
  event: EventRow,
  settings: PaymentSettings,
  now: Date,
  tickets: TicketView[],
): ReservationView {
  const status = effectiveStatus(row, now)
  let payment: ReservationView['payment'] = null
  if (status === 'pending' && row.paymentMethod && row.totalAmountCents > 0) {
    payment = {
      method: row.paymentMethod,
      amountCents: row.totalAmountCents,
      reference: row.reference,
      availableMethods: availablePaymentMethods(settings),
      ...(row.paymentMethod === 'wero'
        ? {
            weroInstructions: settings.weroInstructions,
            weroQrImageUrl: settings.weroQrImageUrl,
            weroContact: settings.weroContact,
          }
        : row.paymentMethod === 'revolut'
          ? { revolutUrl: settings.revolutMeUrl ? buildRevolutLink(settings.revolutMeUrl) : null }
          : {
              paypalUrl: settings.paypalMeUrl
                ? buildPaypalLink(settings.paypalMeUrl, row.totalAmountCents)
                : null,
            }),
    }
  }
  return {
    reference: row.reference,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    quantity: row.quantity,
    guests: parseGuests(row.guests),
    totalAmountCents: row.totalAmountCents,
    paymentMethod: row.paymentMethod,
    status,
    paymentDeclaredAt: row.paymentDeclaredAt,
    expiresAt: status === 'pending' ? row.expiresAt : null,
    createdAt: row.createdAt,
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
    payment,
    tickets,
  }
}

const UNIT_PRICE = currentPriceSql('e', '?12')

const INSERT_RESERVATION_SQL = `
INSERT INTO reservations (
  id, event_id, reference, first_name, last_name, email, phone, quantity,
  total_amount_cents, payment_method, payment_status, access_token_hash, idempotency_key,
  expires_at, confirmed_at, created_at, guests
)
SELECT
  ?1, e.id, ?2, ?3, ?4, ?5, ?6, ?7,
  ${UNIT_PRICE} * ?7,
  CASE WHEN ${UNIT_PRICE} = 0 THEN NULL ELSE ?8 END,
  CASE WHEN ${UNIT_PRICE} = 0 THEN 'confirmed' ELSE 'pending' END,
  ?9, ?10,
  CASE WHEN ${UNIT_PRICE} = 0 THEN NULL ELSE ?11 END,
  CASE WHEN ${UNIT_PRICE} = 0 THEN ?12 ELSE NULL END,
  ?12,
  ?14
FROM events e
WHERE e.id = ?13
  AND e.status = 'published'
  AND e.starts_at > ?12
  AND (e.booking_deadline IS NULL OR e.booking_deadline > ?12)
  AND ?7 <= e.max_per_booking
  AND (${UNIT_PRICE} = 0 OR ?8 IS NOT NULL)
  AND (
    SELECT COALESCE(SUM(r.quantity), 0) FROM reservations r
    WHERE r.event_id = e.id
      AND (r.payment_status = 'confirmed' OR (r.payment_status = 'pending' AND r.expires_at > ?12))
  ) + ?7 <= e.capacity
  AND (
    ${UNIT_PRICE} = 0 OR NOT EXISTS (
      SELECT 1 FROM reservations r2
      WHERE r2.event_id = e.id AND r2.email = ?5
        AND r2.payment_status = 'pending' AND r2.expires_at > ?12
    )
  )`

export async function createReservation(
  env: Env,
  eventId: string,
  input: ReservationInput,
  now: Date,
): Promise<CreatedReservation> {
  const db = getDb(env.DB)
  const nowIso = now.toISOString()

  const event = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!event || event.status === 'draft') throw notFound('event_not_found', 'Événement introuvable.')

  await expireDueReservations(db, now, eventId)
  const settings = await getPaymentSettings(db)

  if (currentPriceCents(event, now) > 0) {
    if (!input.paymentMethod) {
      throw new ApiError(422, 'validation_error', 'Choisissez un moyen de paiement.', {
        paymentMethod: 'Choisissez un moyen de paiement',
      })
    }
    if (!availablePaymentMethods(settings).includes(input.paymentMethod)) {
      throw new ApiError(
        422,
        'payment_method_unavailable',
        "Ce moyen de paiement n'est pas disponible pour le moment.",
        { paymentMethod: "Ce moyen de paiement n'est pas disponible" },
      )
    }
  }
  if (input.quantity > event.maxPerBooking) {
    throw new ApiError(
      422,
      'validation_error',
      `Maximum ${event.maxPerBooking} place(s) par réservation.`,
      { quantity: `Maximum ${event.maxPerBooking} place(s) par réservation` },
    )
  }

  const expiresAt = addHours(now, settings.pendingTtlHours).toISOString()
  const accessToken = randomToken(32)
  const accessTokenHash = await sha256Hex(accessToken)
  const id = randomId()

  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = randomReference()
    try {
      const result = await env.DB.prepare(INSERT_RESERVATION_SQL)
        .bind(
          id,
          reference,
          input.firstName,
          input.lastName,
          input.email,
          input.phone,
          input.quantity,
          input.paymentMethod,
          accessTokenHash,
          input.idempotencyKey,
          expiresAt,
          nowIso,
          eventId,
          input.guests.length > 0 ? JSON.stringify(input.guests) : null,
        )
        .run()
      if (result.meta.changes === 0) await explainRefusal(db, event, input, now)
      const row = await db.select().from(reservations).where(eq(reservations.id, id)).get()
      if (!row) throw new ApiError(500, 'insert_failed', 'La réservation a échoué.')
      if (row.paymentStatus === 'confirmed') await issueTickets(env, row.id, now)
      return {
        accessToken,
        reservation: buildView(row, event, settings, now, await ticketViewsFor(env, row, event)),
      }
    } catch (err) {
      if (isUniqueViolation(err, 'reservations.reference')) continue
      if (isUniqueViolation(err, 'idempotency_key')) throw duplicateSubmission()
      throw err
    }
  }
  throw new ApiError(500, 'reference_generation_failed', 'Impossible de générer une référence.')
}

function duplicateSubmission() {
  return conflict(
    'duplicate_submission',
    'Cette réservation a déjà été enregistrée. Utilisez le lien de suivi qui vous a été affiché.',
  )
}

/** Le INSERT … SELECT atomique a refusé : détermine pourquoi (toujours une erreur 409/422). */
async function explainRefusal(
  db: Db,
  event: EventRow,
  input: ReservationInput,
  now: Date,
): Promise<never> {
  const nowIso = now.toISOString()
  if (input.idempotencyKey) {
    const existing = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(eq(reservations.eventId, event.id), eq(reservations.idempotencyKey, input.idempotencyKey)),
      )
      .get()
    if (existing) throw duplicateSubmission()
  }

  const fresh = (await db.select().from(events).where(eq(events.id, event.id)).get()) ?? event
  const taken = await db
    .select({
      total: sql<number>`COALESCE(SUM(${reservations.quantity}), 0)`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.eventId, event.id),
        sql`(${reservations.paymentStatus} = 'confirmed' OR (${reservations.paymentStatus} = 'pending' AND ${reservations.expiresAt} > ${nowIso}))`,
      ),
    )
    .get()
  const remaining = Math.max(0, fresh.capacity - (taken?.total ?? 0))

  const reason = bookingBlockReason(fresh, remaining, now)
  if (reason && reason !== 'full') throw conflict(`booking_${reason}`, BLOCK_REASON_MESSAGES[reason])

  if (currentPriceCents(fresh, now) > 0) {
    const duplicate = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.eventId, event.id),
          eq(reservations.email, input.email),
          eq(reservations.paymentStatus, 'pending'),
          sql`${reservations.expiresAt} > ${nowIso}`,
        ),
      )
      .get()
    if (duplicate) {
      throw conflict(
        'duplicate_pending',
        'Une réservation en attente existe déjà avec cet e-mail. Retrouvez son lien de suivi, ou demandez-le à l\'organisateur.',
      )
    }
  }

  if (input.quantity > remaining) {
    throw conflict(
      'not_enough_places',
      remaining === 0
        ? BLOCK_REASON_MESSAGES.full
        : `Il ne reste que ${remaining} place${remaining > 1 ? 's' : ''}.`,
    )
  }
  throw conflict('booking_unavailable', 'La réservation est momentanément impossible. Réessayez.')
}

async function findByToken(db: Db, accessToken: string) {
  const hash = await sha256Hex(accessToken)
  const row = await db
    .select({ reservation: reservations, event: events })
    .from(reservations)
    .innerJoin(events, eq(events.id, reservations.eventId))
    .where(eq(reservations.accessTokenHash, hash))
    .get()
  if (!row) throw notFound('reservation_not_found', 'Réservation introuvable.')
  return row
}

export async function getReservationView(
  env: Env,
  accessToken: string,
  now: Date,
): Promise<ReservationView> {
  const db = getDb(env.DB)
  const row = await findByToken(db, accessToken)
  if (effectiveStatus(row.reservation, now) === 'expired' && row.reservation.paymentStatus === 'pending') {
    await expireDueReservations(db, now, row.event.id)
  }
  return buildView(
    row.reservation,
    row.event,
    await getPaymentSettings(db),
    now,
    await ticketViewsFor(env, row.reservation, row.event),
  )
}

export async function declarePayment(
  env: Env,
  accessToken: string,
  now: Date,
): Promise<ReservationView> {
  const db = getDb(env.DB)
  const row = await findByToken(db, accessToken)
  if (effectiveStatus(row.reservation, now) !== 'pending') {
    throw conflict('not_pending', "Cette réservation n'attend plus de paiement.")
  }
  await db
    .update(reservations)
    .set({ paymentDeclaredAt: sql`COALESCE(${reservations.paymentDeclaredAt}, ${now.toISOString()})` })
    .where(and(eq(reservations.id, row.reservation.id), eq(reservations.paymentStatus, 'pending')))
  return getReservationView(env, accessToken, now)
}

/** Permet à l'invité de changer de moyen de paiement tant que la réservation attend son paiement. */
export async function changePaymentMethod(
  env: Env,
  accessToken: string,
  method: PaymentMethod,
  now: Date,
): Promise<ReservationView> {
  const db = getDb(env.DB)
  const row = await findByToken(db, accessToken)
  const current = row.reservation
  if (effectiveStatus(current, now) !== 'pending' || current.totalAmountCents === 0) {
    throw conflict('not_pending', "Cette réservation n'attend plus de paiement.")
  }
  const settings = await getPaymentSettings(db)
  if (!availablePaymentMethods(settings).includes(method)) {
    throw new ApiError(
      422,
      'payment_method_unavailable',
      "Ce moyen de paiement n'est pas disponible pour le moment.",
      { paymentMethod: "Ce moyen de paiement n'est pas disponible" },
    )
  }
  if (current.paymentMethod !== method) {
    await db
      .update(reservations)
      .set({ paymentMethod: method, paymentDeclaredAt: null })
      .where(and(eq(reservations.id, current.id), eq(reservations.paymentStatus, 'pending')))
  }
  return getReservationView(env, accessToken, now)
}

/* ---------------------------------- Admin ---------------------------------- */

function toAdminReservation(
  row: ReservationRow,
  eventTitle: string,
): AdminReservation {
  return {
    id: row.id,
    eventId: row.eventId,
    eventTitle,
    reference: row.reference,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    quantity: row.quantity,
    guests: parseGuests(row.guests),
    totalAmountCents: row.totalAmountCents,
    paymentMethod: row.paymentMethod,
    status: row.paymentStatus,
    paymentDeclaredAt: row.paymentDeclaredAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    ticketsEmailedAt: row.ticketsEmailedAt,
    remindedAt: row.remindedAt,
  }
}

export interface ReservationFilters {
  q?: string | undefined
  eventId?: string | undefined
  status?: ReservationStatus | undefined
  limit?: number
  offset?: number
}

function filterConditions(f: ReservationFilters): SQL | undefined {
  const conditions: SQL[] = []
  if (f.eventId) conditions.push(eq(reservations.eventId, f.eventId))
  if (f.status) conditions.push(eq(reservations.paymentStatus, f.status))
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(
      sql`(${reservations.firstName} || ' ' || ${reservations.lastName} LIKE ${like} ESCAPE '\\'
        OR ${reservations.email} LIKE ${like} ESCAPE '\\'
        OR ${reservations.reference} LIKE ${like} ESCAPE '\\')`,
    )
  }
  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listReservations(
  env: Env,
  filters: ReservationFilters,
  now: Date,
): Promise<AdminReservationsPage> {
  const db = getDb(env.DB)
  await expireDueReservations(db, now)
  const where = filterConditions(filters)
  const [rows, count] = await Promise.all([
    db
      .select({ reservation: reservations, title: events.title })
      .from(reservations)
      .innerJoin(events, eq(events.id, reservations.eventId))
      .where(where)
      .orderBy(desc(reservations.createdAt))
      .limit(filters.limit ?? 200)
      .offset(filters.offset ?? 0),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(reservations)
      .where(where)
      .get(),
  ])
  return {
    items: rows.map((r) => toAdminReservation(r.reservation, r.title)),
    total: count?.total ?? 0,
  }
}

async function getAdminReservation(db: Db, id: string): Promise<AdminReservation> {
  const row = await db
    .select({ reservation: reservations, title: events.title })
    .from(reservations)
    .innerJoin(events, eq(events.id, reservations.eventId))
    .where(eq(reservations.id, id))
    .get()
  if (!row) throw notFound('reservation_not_found', 'Réservation introuvable.')
  return toAdminReservation(row.reservation, row.title)
}

export async function getAdminReservationById(env: Env, id: string): Promise<AdminReservation> {
  return getAdminReservation(getDb(env.DB), id)
}

export async function confirmReservation(env: Env, id: string, now: Date): Promise<AdminReservation> {
  const db = getDb(env.DB)
  await expireDueReservations(db, now)
  const updated = await db
    .update(reservations)
    .set({ paymentStatus: 'confirmed', confirmedAt: now.toISOString(), expiresAt: null })
    .where(and(eq(reservations.id, id), eq(reservations.paymentStatus, 'pending')))
    .returning({ id: reservations.id })
  if (updated.length === 0) {
    const current = await getAdminReservation(db, id)
    throw conflict(
      'invalid_transition',
      current.status === 'expired'
        ? "Cette réservation a expiré : l'invité doit refaire une réservation."
        : 'Seule une réservation en attente peut être confirmée.',
    )
  }
  await issueTickets(env, id, now)
  return getAdminReservation(db, id)
}

export async function cancelReservation(env: Env, id: string, now: Date): Promise<AdminReservation> {
  const db = getDb(env.DB)
  const updated = await db
    .update(reservations)
    .set({ paymentStatus: 'cancelled', cancelledAt: now.toISOString(), expiresAt: null })
    .where(
      and(
        eq(reservations.id, id),
        sql`${reservations.paymentStatus} IN ('pending', 'confirmed')`,
      ),
    )
    .returning({ id: reservations.id })
  if (updated.length === 0) {
    await getAdminReservation(db, id)
    throw conflict('invalid_transition', 'Cette réservation est déjà annulée ou expirée.')
  }
  await voidTickets(env, id, now)
  return getAdminReservation(db, id)
}

/** Supprime définitivement une réservation annulée ou expirée (et ses billets, déjà invalidés). */
export async function deleteInactiveReservation(env: Env, id: string): Promise<void> {
  const db = getDb(env.DB)
  const current = await getAdminReservation(db, id)
  if (current.status !== 'cancelled' && current.status !== 'expired') {
    throw conflict('invalid_transition', 'Seule une réservation annulée ou expirée peut être supprimée.')
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM tickets WHERE reservation_id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM reservations WHERE id = ?1 AND payment_status IN ('cancelled', 'expired')`).bind(id),
  ])
}

/** Génère un nouveau jeton de suivi ; l'ancien est invalidé. Le jeton n'est renvoyé qu'une fois. */
export async function regenerateAccessLink(
  env: Env,
  id: string,
): Promise<{ accessToken: string }> {
  const db = getDb(env.DB)
  const accessToken = randomToken(32)
  const updated = await db
    .update(reservations)
    .set({ accessTokenHash: await sha256Hex(accessToken) })
    .where(eq(reservations.id, id))
    .returning({ id: reservations.id })
  if (updated.length === 0) throw notFound('reservation_not_found', 'Réservation introuvable.')
  return { accessToken }
}

/* ----------------------------------- CSV ----------------------------------- */

/** Neutralise l'injection de formules (=, +, -, @) et applique l'échappement CSV. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
  expired: 'Expirée',
}

export async function exportReservationsCsv(
  env: Env,
  filters: ReservationFilters,
  now: Date,
): Promise<string> {
  const { items } = await listReservations(env, { ...filters, limit: 5000, offset: 0 }, now)
  const header = [
    'Référence', 'Événement', 'Prénom', 'Nom', 'E-mail', 'Téléphone', 'Places', 'Participants',
    'Montant (EUR)', 'Moyen de paiement', 'Statut', 'Paiement déclaré', 'Réservé le',
  ]
  const lines = items.map((r) =>
    [
      r.reference,
      r.eventTitle,
      r.firstName,
      r.lastName,
      r.email,
      r.phone,
      r.quantity,
      r.guests.map((g) => `${g.firstName} ${g.lastName}`).join(', '),
      (r.totalAmountCents / 100).toFixed(2).replace('.', ','),
      r.paymentMethod,
      STATUS_LABELS[r.status],
      r.paymentDeclaredAt ? 'oui' : 'non',
      r.createdAt,
    ]
      .map(csvCell)
      .join(';'),
  )
  return `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`
}
