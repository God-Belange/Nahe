import { Hono } from 'hono'
import { reservationInputSchema } from '../../shared/schemas'
import { ApiError } from '../lib/errors'
import { parseBody } from '../lib/http'
import type { AppEnv } from '../middleware/security'
import { getEventByInviteToken, getPublicEventBySlug, listPublicEvents } from '../services/events'
import { hitRateLimit, rateLimitKey } from '../services/rate-limit'
import { sendTicketsEmail } from '../services/mailer'
import { createReservation, declarePayment, getReservationView } from '../services/reservations'
import { getPublicTicket, verifyTicketToken } from '../services/tickets'
import { qrPng } from '../lib/qr'
import { notFound } from '../lib/errors'

export const RESERVATION_LIMIT = { max: 5, windowMs: 3_600_000 }
export const DECLARE_LIMIT = { max: 10, windowMs: 3_600_000 }

export const publicRoutes = new Hono<AppEnv>()

publicRoutes.get('/events', async (c) => c.json(await listPublicEvents(c.env, new Date())))

publicRoutes.get('/events/:slug', async (c) =>
  c.json(await getPublicEventBySlug(c.env, c.req.param('slug'), new Date())),
)

publicRoutes.get('/invites/:inviteToken', async (c) =>
  c.json(await getEventByInviteToken(c.env, c.req.param('inviteToken'), new Date())),
)

publicRoutes.post('/events/:id/reservations', async (c) => {
  const input = await parseBody(c, reservationInputSchema)
  const now = new Date()
  const key = await rateLimitKey(c.env, c.req.raw, 'reserve')
  if ((await hitRateLimit(c.env.DB, key, RESERVATION_LIMIT.windowMs, now)) > RESERVATION_LIMIT.max) {
    throw new ApiError(429, 'rate_limited', 'Trop de tentatives. Réessayez dans une heure.')
  }
  const created = await createReservation(c.env, c.req.param('id'), input, now)
  if (created.reservation.status === 'confirmed') {
    await sendTicketsEmailForCreated(c.env, created.reservation.reference, new URL(c.req.url).origin, now)
  }
  return c.json(created, 201)
})

publicRoutes.get('/reservations/:accessToken', async (c) =>
  c.json(await getReservationView(c.env, c.req.param('accessToken'), new Date())),
)

publicRoutes.post('/reservations/:accessToken/declare-payment', async (c) => {
  const now = new Date()
  const key = await rateLimitKey(c.env, c.req.raw, 'declare')
  if ((await hitRateLimit(c.env.DB, key, DECLARE_LIMIT.windowMs, now)) > DECLARE_LIMIT.max) {
    throw new ApiError(429, 'rate_limited', 'Trop de tentatives. Réessayez plus tard.')
  }
  return c.json(await declarePayment(c.env, c.req.param('accessToken'), now))
})

async function sendTicketsEmailForCreated(env: Env, reference: string, origin: string, now: Date) {
  const row = await env.DB.prepare('SELECT id FROM reservations WHERE reference = ?1')
    .bind(reference)
    .first<{ id: string }>()
  if (row) await sendTicketsEmail(env, row.id, origin, now)
}

publicRoutes.get('/tickets/:token', async (c) =>
  c.json(await getPublicTicket(c.env, c.req.param('token'))),
)

/** Contenu du QR code : l'écran de contrôle admin, qui n'a d'effet qu'après validation explicite. */
export function ticketQrPayload(origin: string, token: string): string {
  return `${origin}/admin/scan?t=${encodeURIComponent(token)}`
}

publicRoutes.get('/tickets/:token/qr.png', async (c) => {
  const token = c.req.param('token')
  if (!(await verifyTicketToken(c.env, token))) throw notFound('ticket_not_found', 'Billet introuvable.')
  const png = qrPng(ticketQrPayload(new URL(c.req.url).origin, token))
  return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' })
})
