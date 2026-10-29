import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { bookingBlockReason } from '../../shared/booking'
import type { EventStatus, PaymentMethod } from '../../shared/constants'
import { checkEventDates } from '../../shared/schemas'
import type { CreateEventInput, UpdateEventInput } from '../../shared/schemas'
import type {
  AdminEvent,
  AdminEventDetail,
  PublicEvent,
  RefundItem,
} from '../../shared/types'
import { events, reservations } from '../db/schema'
import { ApiError, conflict, notFound } from '../lib/errors'
import { randomId, randomToken } from '../lib/crypto'
import { getDb, type Db } from '../lib/db'
import { isUniqueViolation } from '../lib/sql-errors'
import { availablePaymentMethods, getPaymentSettings } from './settings'

type EventRow = typeof events.$inferSelect

/** Places confirmées (sous-requête corrélée ; noms de tables littéraux car Drizzle omet les préfixes sur une table unique). */
const confirmedPlacesSql = sql<number>`COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.event_id = "events"."id" AND r.payment_status = 'confirmed'), 0)`

function pendingPlacesSql(nowIso: string) {
  return sql<number>`COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.event_id = "events"."id" AND r.payment_status = 'pending' AND r.expires_at > ${nowIso}), 0)`
}

function selection(nowIso: string) {
  return { event: events, confirmed: confirmedPlacesSql, pending: pendingPlacesSql(nowIso) }
}

export function toPublicEvent(
  row: EventRow,
  taken: number,
  methods: PaymentMethod[],
  now: Date,
): PublicEvent {
  const remaining = Math.max(0, row.capacity - taken)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    priceCents: row.priceCents,
    capacity: row.capacity,
    remaining,
    bookingDeadline: row.bookingDeadline,
    extraInfo: row.extraInfo,
    status: row.status,
    maxPerBooking: row.maxPerBooking,
    paymentMethods: row.priceCents > 0 ? methods : [],
    blockReason: bookingBlockReason(row, remaining, now),
  }
}

interface Row {
  event: EventRow
  confirmed: number
  pending: number
}

function toAdminEvent(r: Row, methods: PaymentMethod[], now: Date): AdminEvent {
  return {
    ...toPublicEvent(r.event, r.confirmed + r.pending, methods, now),
    visibility: r.event.visibility,
    inviteToken: r.event.inviteToken,
    confirmedPlaces: r.confirmed,
    pendingPlaces: r.pending,
    createdAt: r.event.createdAt,
    updatedAt: r.event.updatedAt,
  }
}

async function methodsFor(db: Db) {
  return availablePaymentMethods(await getPaymentSettings(db))
}

export async function listPublicEvents(env: Env, now: Date): Promise<PublicEvent[]> {
  const db = getDb(env.DB)
  const nowIso = now.toISOString()
  const [rows, methods] = await Promise.all([
    db
      .select(selection(nowIso))
      .from(events)
      .where(
        and(
          inArray(events.status, ['published', 'closed']),
          eq(events.visibility, 'public'),
          sql`${events.startsAt} > ${nowIso}`,
        ),
      )
      .orderBy(asc(events.startsAt)),
    methodsFor(db),
  ])
  return rows.map((r) => toPublicEvent(r.event, r.confirmed + r.pending, methods, now))
}

async function getPublicBy(env: Env, where: SQL | undefined, now: Date) {
  const db = getDb(env.DB)
  const [row, methods] = await Promise.all([
    db
      .select(selection(now.toISOString()))
      .from(events)
      .where(and(where, ne(events.status, 'draft')))
      .get(),
    methodsFor(db),
  ])
  if (!row) throw notFound('event_not_found', 'Événement introuvable.')
  return toPublicEvent(row.event, row.confirmed + row.pending, methods, now)
}

export function getPublicEventBySlug(env: Env, slug: string, now: Date) {
  return getPublicBy(env, and(eq(events.slug, slug), eq(events.visibility, 'public')), now)
}

export function getEventByInviteToken(env: Env, token: string, now: Date) {
  return getPublicBy(env, eq(events.inviteToken, token), now)
}

export async function listAdminEvents(env: Env, now: Date): Promise<AdminEvent[]> {
  const db = getDb(env.DB)
  const [rows, methods] = await Promise.all([
    db.select(selection(now.toISOString())).from(events).orderBy(desc(events.startsAt)),
    methodsFor(db),
  ])
  return rows.map((r) => toAdminEvent(r, methods, now))
}

async function refundsFor(db: Db, eventId: string): Promise<RefundItem[]> {
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.eventId, eventId),
        eq(reservations.paymentStatus, 'confirmed'),
        sql`${reservations.totalAmountCents} > 0`,
      ),
    )
    .orderBy(asc(reservations.createdAt))
  return rows.map((r) => ({
    reservationId: r.id,
    reference: r.reference,
    name: `${r.firstName} ${r.lastName}`.trim(),
    email: r.email,
    amountCents: r.totalAmountCents,
    paymentMethod: r.paymentMethod,
  }))
}

export async function getAdminEvent(env: Env, id: string, now: Date): Promise<AdminEventDetail> {
  const db = getDb(env.DB)
  const [row, methods] = await Promise.all([
    db.select(selection(now.toISOString())).from(events).where(eq(events.id, id)).get(),
    methodsFor(db),
  ])
  if (!row) throw notFound('event_not_found', 'Événement introuvable.')
  const refundsToProcess = row.event.status === 'cancelled' ? await refundsFor(db, id) : []
  return { ...toAdminEvent(row, methods, now), refundsToProcess }
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug.length >= 3 ? slug : 'evenement'
}

export async function createEvent(
  env: Env,
  input: CreateEventInput,
  now: Date,
): Promise<AdminEventDetail> {
  const db = getDb(env.DB)
  const nowIso = now.toISOString()
  const id = randomId()
  const explicitSlug = input.slug
  const base = explicitSlug ?? slugify(input.title)

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`
    try {
      await db.insert(events).values({
        id,
        slug,
        inviteToken: randomToken(24),
        visibility: input.visibility,
        title: input.title,
        description: input.description,
        coverImageUrl: input.coverImageUrl,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        priceCents: input.priceCents,
        capacity: input.capacity,
        bookingDeadline: input.bookingDeadline,
        extraInfo: input.extraInfo,
        maxPerBooking: input.maxPerBooking,
        status: 'draft',
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      return getAdminEvent(env, id, now)
    } catch (err) {
      if (!isUniqueViolation(err, 'events.slug')) throw err
      if (explicitSlug) {
        throw new ApiError(422, 'validation_error', 'Ce slug est déjà utilisé.', {
          slug: 'Ce slug est déjà utilisé',
        })
      }
    }
  }
  throw new ApiError(500, 'slug_generation_failed', 'Impossible de générer un identifiant unique.')
}

export async function updateEvent(
  env: Env,
  id: string,
  patch: UpdateEventInput,
  now: Date,
): Promise<AdminEventDetail> {
  const db = getDb(env.DB)
  const nowIso = now.toISOString()
  const current = await db.select(selection(nowIso)).from(events).where(eq(events.id, id)).get()
  if (!current) throw notFound('event_not_found', 'Événement introuvable.')

  const merged = { ...current.event, ...definedOnly(patch) }
  const fieldErrors = checkEventDates(merged)
  if (Object.keys(fieldErrors).length > 0) {
    throw new ApiError(422, 'validation_error', 'Dates incohérentes.', fieldErrors)
  }

  const taken = current.confirmed + current.pending
  if (patch.capacity !== undefined && patch.capacity < taken) {
    throw capacityError(taken)
  }

  const set = { ...definedOnly(patch), updatedAt: nowIso }
  const condition =
    patch.capacity !== undefined
      ? and(
          eq(events.id, id),
          sql`${patch.capacity} >= ${confirmedPlacesSql} + ${pendingPlacesSql(nowIso)}`,
        )
      : eq(events.id, id)

  try {
    const updated = await db.update(events).set(set).where(condition).returning({ id: events.id })
    if (updated.length === 0) throw capacityError(taken)
  } catch (err) {
    if (isUniqueViolation(err, 'events.slug')) {
      throw new ApiError(422, 'validation_error', 'Ce slug est déjà utilisé.', {
        slug: 'Ce slug est déjà utilisé',
      })
    }
    throw err
  }
  return getAdminEvent(env, id, now)
}

function capacityError(taken: number) {
  return new ApiError(
    422,
    'capacity_below_booked',
    `Impossible de réduire la capacité sous ${taken} place(s) déjà prise(s).`,
    { capacity: `Au moins ${taken} (places déjà prises)` },
  )
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

export type EventAction = 'publish' | 'unpublish' | 'close' | 'cancel'

const TRANSITIONS: Record<EventAction, { from: EventStatus[]; to: EventStatus }> = {
  publish: { from: ['draft', 'closed'], to: 'published' },
  unpublish: { from: ['published', 'closed'], to: 'draft' },
  close: { from: ['published'], to: 'closed' },
  cancel: { from: ['draft', 'published', 'closed'], to: 'cancelled' },
}

export async function transitionEvent(
  env: Env,
  id: string,
  action: EventAction,
  now: Date,
): Promise<AdminEventDetail> {
  const db = getDb(env.DB)
  const rule = TRANSITIONS[action]
  const updated = await db
    .update(events)
    .set({ status: rule.to, updatedAt: now.toISOString() })
    .where(and(eq(events.id, id), inArray(events.status, rule.from)))
    .returning({ id: events.id })
  if (updated.length === 0) {
    const exists = await db.select({ id: events.id }).from(events).where(eq(events.id, id)).get()
    if (!exists) throw notFound('event_not_found', 'Événement introuvable.')
    throw conflict('invalid_transition', "Cette action n'est pas possible dans l'état actuel de l'événement.")
  }
  return getAdminEvent(env, id, now)
}
