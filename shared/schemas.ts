import './zod-fr'
import { z } from 'zod'
import {
  DEFAULT_MAX_PER_BOOKING,
  DEFAULT_PENDING_TTL_HOURS,
  EVENT_VISIBILITIES,
  PAYMENT_METHODS,
  RESERVATION_STATUSES,
} from './constants'
import {
  EMAIL_TEMPLATE_KINDS,
  EMAIL_TEMPLATE_LIMITS,
  unknownPlaceholders,
  type EmailTemplateKind,
} from './email-templates'
import { normalizePhone } from './phone'
import { parsePaypalMe } from './paypal'
import { parseRevolutMe } from './revolut'

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide')
  .transform((v) => new Date(v).toISOString())

const imagePath = z
  .string()
  .trim()
  .max(200)
  .refine(
    (v) =>
      (/^\/images\/[A-Za-z0-9._/-]+$/.test(v) && !v.includes('..')) ||
      /^\/api\/images\/[A-Za-z0-9_-]{16,64}$/.test(v),
    { message: 'Chemin invalide : il doit commencer par /images/' },
  )

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

export const guestSchema = z.object({
  firstName: trimmed(1, 80),
  lastName: trimmed(1, 80),
})

export const reservationInputSchema = z
  .object({
    firstName: trimmed(1, 80),
    lastName: trimmed(1, 80),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    phone: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .transform((v, ctx) => {
        const normalized = normalizePhone(v)
        if (normalized === null) {
          ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone invalide' })
          return z.NEVER
        }
        return normalized
      }),
    quantity: z.number().int().min(1).max(100).default(1),
    /** Prénom et nom des places 2 à N (la place 1 est celle du titulaire de la réservation). */
    guests: z.array(guestSchema).max(99).default([]),
    paymentMethod: z.enum(PAYMENT_METHODS).nullish().transform((v) => v ?? null),
    idempotencyKey: z.uuid().nullish().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    const expected = v.quantity - 1
    if (v.guests.length > expected) {
      ctx.addIssue({ code: 'custom', path: ['guests'], message: 'Trop de participants pour ce nombre de places' })
    }
    for (let i = v.guests.length; i < expected; i++) {
      ctx.addIssue({ code: 'custom', path: ['guests', i, 'firstName'], message: 'Ce champ est obligatoire' })
      ctx.addIssue({ code: 'custom', path: ['guests', i, 'lastName'], message: 'Ce champ est obligatoire' })
    }
  })
export type ReservationInput = z.infer<typeof reservationInputSchema>

const slugField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Uniquement lettres minuscules, chiffres et tirets')
    .min(3)
    .max(80)
    .optional(),
)
const nullableDate = z.preprocess(emptyToNull, isoDate.nullable())
const nullableImage = z.preprocess(emptyToNull, imagePath.nullable())
const nullablePrice = z.number().int().min(0).max(1_000_000).nullable()

const requiredShape = {
  title: trimmed(1, 120),
  location: trimmed(1, 200),
  startsAt: isoDate,
  priceCents: z.number().int().min(0).max(1_000_000),
  capacity: z.number().int().min(1).max(10_000),
}
const optionalShape = {
  description: z.string().trim().max(5000),
  extraInfo: z.string().trim().max(2000),
  visibility: z.enum(EVENT_VISIBILITIES),
  maxPerBooking: z.number().int().min(1).max(100),
  address: z.string().trim().max(300),
  showRemaining: z.boolean(),
}

export interface EventDates {
  startsAt: string
  endsAt: string | null
  bookingDeadline: string | null
  doorPriceCents?: number | null
  doorPriceFrom?: string | null
}

/** Retourne la liste des erreurs de cohérence de dates (champ → message). */
export function checkEventDates(d: EventDates): Record<string, string> {
  const errors: Record<string, string> = {}
  if (d.endsAt !== null && d.endsAt <= d.startsAt) {
    errors.endsAt = 'La fin doit être postérieure au début'
  }
  if (d.bookingDeadline !== null && d.bookingDeadline > d.startsAt) {
    errors.bookingDeadline = 'La date limite doit précéder le début'
  }
  const hasDoorPrice = d.doorPriceCents != null
  const hasDoorFrom = d.doorPriceFrom != null
  if (hasDoorPrice && !hasDoorFrom) errors.doorPriceFrom = "Indiquez la date d'application du prix sur place"
  if (hasDoorFrom && !hasDoorPrice) errors.doorPriceCents = 'Indiquez le prix sur place'
  if (d.doorPriceFrom != null && d.doorPriceFrom > d.startsAt) {
    errors.doorPriceFrom = "Le prix sur place doit s'appliquer au plus tard au début de l'événement"
  }
  return errors
}

export const createEventSchema = z
  .object({
    ...requiredShape,
    description: optionalShape.description.default(''),
    extraInfo: optionalShape.extraInfo.default(''),
    visibility: optionalShape.visibility.default('public'),
    maxPerBooking: optionalShape.maxPerBooking.default(DEFAULT_MAX_PER_BOOKING),
    address: optionalShape.address.default(''),
    showRemaining: optionalShape.showRemaining.default(true),
    coverImageUrl: nullableImage.nullish().transform((v) => v ?? null),
    endsAt: nullableDate.nullish().transform((v) => v ?? null),
    bookingDeadline: nullableDate.nullish().transform((v) => v ?? null),
    doorPriceCents: nullablePrice.nullish().transform((v) => v ?? null),
    doorPriceFrom: nullableDate.nullish().transform((v) => v ?? null),
    slug: slugField,
  })
  .superRefine((v, ctx) => {
    for (const [path, message] of Object.entries(checkEventDates(v))) {
      ctx.addIssue({ code: 'custom', path: [path], message })
    }
  })
export type CreateEventInput = z.infer<typeof createEventSchema>

/** Mise à jour partielle : seuls les champs présents sont modifiés (null efface un champ facultatif). */
export const updateEventSchema = z
  .object({
    ...requiredShape,
    ...optionalShape,
    coverImageUrl: nullableImage,
    endsAt: nullableDate,
    bookingDeadline: nullableDate,
    doorPriceCents: nullablePrice,
    doorPriceFrom: nullableDate,
    slug: slugField,
  })
  .partial()
export type UpdateEventInput = z.infer<typeof updateEventSchema>

export const changePaymentMethodSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
})

export const loginSchema = z.object({
  password: z.string().min(1).max(200),
})

export const paymentSettingsSchema = z.object({
  weroInstructions: z.string().trim().max(1000).default(''),
  weroQrImageUrl: z
    .preprocess(emptyToNull, imagePath.nullable().optional())
    .transform((v) => v ?? null),
  weroContact: z
    .preprocess(emptyToNull, z.string().trim().max(100).nullable().optional())
    .transform((v) => v ?? null),
  paypalMeUrl: z
    .preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .max(200)
        .refine((v) => parsePaypalMe(v) !== null, {
          message: 'Lien PayPal.Me invalide (https://paypal.me/votrecompte)',
        })
        .nullable()
        .optional(),
    )
    .transform((v) => v ?? null),
  revolutMeUrl: z
    .preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .max(200)
        .refine((v) => parseRevolutMe(v) !== null, {
          message: 'Lien Revolut.me invalide (https://revolut.me/votrecompte)',
        })
        .nullable()
        .optional(),
    )
    .transform((v) => v ?? null),
  pendingTtlHours: z.number().int().min(1).max(168).default(DEFAULT_PENDING_TTL_HOURS),
})
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>

export const emailTemplateKindSchema = z.enum(EMAIL_TEMPLATE_KINDS)

export function emailTemplateSchema(kind: EmailTemplateKind) {
  return z
    .object({
      subject: trimmed(1, EMAIL_TEMPLATE_LIMITS.subject).refine((v) => !/[\r\n]/.test(v), {
        message: "L'objet doit tenir sur une seule ligne",
      }),
      intro: trimmed(1, EMAIL_TEMPLATE_LIMITS.intro),
      footer: z.string().trim().max(EMAIL_TEMPLATE_LIMITS.footer),
    })
    .superRefine((value, ctx) => {
      for (const field of ['subject', 'intro', 'footer'] as const) {
        const unknown = unknownPlaceholders(kind, { subject: '', intro: '', footer: '', [field]: value[field] })
        if (unknown.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `Variable inconnue : ${unknown.map((n) => `{{${n}}}`).join(', ')}`,
          })
        }
      }
    })
}
export type EmailTemplateInput = z.infer<ReturnType<typeof emailTemplateSchema>>

export const checkInSchema = z.object({
  token: z.string().trim().min(1).max(200),
  eventId: z.string().trim().max(64).optional(),
})

export const ticketLookupQuerySchema = z.object({
  t: z.string().trim().min(1).max(200),
  eventId: z.string().trim().max(64).optional(),
})

export const adminReservationsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  eventId: z.string().trim().max(64).optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

