import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/** Dates : ISO 8601 UTC (texte), comparables lexicographiquement. Montants : centimes entiers. */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    inviteToken: text('invite_token').notNull(),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    coverImageUrl: text('cover_image_url'),
    location: text('location').notNull(),
    address: text('address').notNull().default(''),
    showRemaining: integer('show_remaining', { mode: 'boolean' }).notNull().default(true),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    priceCents: integer('price_cents').notNull(),
    capacity: integer('capacity').notNull(),
    bookingDeadline: text('booking_deadline'),
    extraInfo: text('extra_info').notNull().default(''),
    maxPerBooking: integer('max_per_booking').notNull().default(10),
    status: text('status', { enum: ['draft', 'published', 'closed', 'cancelled'] }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('events_slug_unique').on(t.slug),
    uniqueIndex('events_invite_token_unique').on(t.inviteToken),
    index('events_status_visibility_starts_idx').on(t.status, t.visibility, t.startsAt),
    check('events_price_check', sql`${t.priceCents} >= 0`),
    check('events_capacity_check', sql`${t.capacity} >= 1`),
    check('events_dates_check', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check(
      'events_deadline_check',
      sql`${t.bookingDeadline} IS NULL OR ${t.bookingDeadline} <= ${t.startsAt}`,
    ),
  ],
)

export const reservations = sqliteTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    reference: text('reference').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    quantity: integer('quantity').notNull(),
    guests: text('guests'),
    totalAmountCents: integer('total_amount_cents').notNull(),
    paymentMethod: text('payment_method', { enum: ['wero', 'paypal', 'revolut'] }),
    paymentStatus: text('payment_status', {
      enum: ['pending', 'confirmed', 'cancelled', 'expired'],
    }).notNull(),
    paymentDeclaredAt: text('payment_declared_at'),
    accessTokenHash: text('access_token_hash').notNull(),
    idempotencyKey: text('idempotency_key'),
    expiresAt: text('expires_at'),
    confirmedAt: text('confirmed_at'),
    cancelledAt: text('cancelled_at'),
    expiredAt: text('expired_at'),
    anonymizedAt: text('anonymized_at'),
    ticketsEmailedAt: text('tickets_emailed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('reservations_reference_unique').on(t.reference),
    uniqueIndex('reservations_access_token_hash_unique').on(t.accessTokenHash),
    uniqueIndex('reservations_event_idempotency_unique').on(t.eventId, t.idempotencyKey),
    index('reservations_event_idx').on(t.eventId),
    index('reservations_event_status_idx').on(t.eventId, t.paymentStatus),
    index('reservations_email_idx').on(t.email),
    index('reservations_status_expires_idx').on(t.paymentStatus, t.expiresAt),
    check('reservations_quantity_check', sql`${t.quantity} >= 1`),
    check('reservations_amount_check', sql`${t.totalAmountCents} >= 0`),
  ],
)

export const tickets = sqliteTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    reservationId: text('reservation_id')
      .notNull()
      .references(() => reservations.id),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    seq: integer('seq').notNull(),
    status: text('status', { enum: ['valid', 'void'] }).notNull(),
    checkedInAt: text('checked_in_at'),
    voidedAt: text('voided_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('tickets_reservation_seq_unique').on(t.reservationId, t.seq),
    index('tickets_event_status_idx').on(t.eventId, t.status),
    check('tickets_seq_check', sql`${t.seq} >= 1`),
  ],
)

export const paymentSettings = sqliteTable('payment_settings', {
  id: integer('id').primaryKey(),
  weroInstructions: text('wero_instructions').notNull().default(''),
  weroQrImageUrl: text('wero_qr_image_url'),
  weroContact: text('wero_contact'),
  paypalMeUrl: text('paypal_me_url'),
  revolutMeUrl: text('revolut_me_url'),
  pendingTtlHours: integer('pending_ttl_hours').notNull().default(24),
  updatedAt: text('updated_at').notNull(),
})

export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey(),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  csrfTokenHash: text('csrf_token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
})

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
)

/** Images téléversées depuis l'admin (réduites côté navigateur), stockées en base64 pour rester dans D1. */
export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  contentType: text('content_type', { enum: ['image/jpeg', 'image/png', 'image/webp'] }).notNull(),
  data: text('data').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
})
