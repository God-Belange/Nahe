import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  adminReservationsQuerySchema,
  checkInSchema,
  createEventSchema,
  loginSchema,
  paymentSettingsSchema,
  ticketLookupQuerySchema,
  updateEventSchema,
} from '../../shared/schemas'
import type { SessionInfo } from '../../shared/types'
import { getDb } from '../lib/db'
import { ApiError } from '../lib/errors'
import { parseBody, parseQuery } from '../lib/http'
import { requireAdmin, SESSION_COOKIE } from '../middleware/admin'
import type { AppEnv } from '../middleware/security'
import {
  authenticateSession,
  checkAdminPassword,
  createSession,
  destroySession,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  SESSION_TTL_SECONDS,
} from '../services/auth'
import { getDashboardStats } from '../services/dashboard'
import {
  createEvent,
  getAdminEvent,
  listAdminEvents,
  transitionEvent,
  updateEvent,
  type EventAction,
} from '../services/events'
import { hitRateLimit, peekRateLimit, rateLimitKey } from '../services/rate-limit'
import {
  cancelReservation,
  confirmReservation,
  exportReservationsCsv,
  getAdminReservationById,
  listReservations,
  regenerateAccessLink,
} from '../services/reservations'
import { sendTicketsEmail } from '../services/mailer'
import { getPaymentSettings, savePaymentSettings } from '../services/settings'
import {
  checkInByToken,
  checkInTicket,
  listEventTickets,
  lookupTicket,
  undoCheckIn,
} from '../services/tickets'

/** Routes de session : accessibles sans être connecté (connexion) ou en gérant elles-mêmes l'authentification. */
export const sessionRoutes = new Hono<AppEnv>()

sessionRoutes.get('/', async (c) => {
  const session = await authenticateSession(c.env, getCookie(c, SESSION_COOKIE, 'host'), new Date())
  const body: SessionInfo = session
    ? { authenticated: true, csrfToken: session.csrfToken }
    : { authenticated: false }
  return c.json(body)
})

sessionRoutes.post('/', async (c) => {
  const { password } = await parseBody(c, loginSchema)
  const now = new Date()
  const key = await rateLimitKey(c.env, c.req.raw, 'login')

  if ((await peekRateLimit(c.env.DB, key, LOGIN_WINDOW_MS, now)) >= LOGIN_MAX_FAILURES) {
    throw new ApiError(429, 'rate_limited', 'Trop de tentatives. Réessayez dans 15 minutes.')
  }
  if (!(await checkAdminPassword(c.env, password))) {
    await hitRateLimit(c.env.DB, key, LOGIN_WINDOW_MS, now)
    throw new ApiError(401, 'invalid_credentials', 'Mot de passe incorrect.')
  }

  const session = await createSession(c.env, now)
  setCookie(c, SESSION_COOKIE, session.sessionToken, {
    prefix: 'host',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  const body: SessionInfo = { authenticated: true, csrfToken: session.csrfToken }
  return c.json(body)
})

sessionRoutes.delete('/', async (c) => {
  const session = await authenticateSession(c.env, getCookie(c, SESSION_COOKIE, 'host'), new Date())
  if (session) await destroySession(c.env, session.id)
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', secure: true, path: '/' })
  return c.json({ ok: true })
})

/** Routes protégées : session valide + jeton CSRF sur les requêtes mutantes. */
export const adminRoutes = new Hono<AppEnv>()
adminRoutes.use('*', requireAdmin)

adminRoutes.get('/dashboard', async (c) => c.json(await getDashboardStats(c.env, new Date())))

adminRoutes.get('/events', async (c) => c.json(await listAdminEvents(c.env, new Date())))

adminRoutes.post('/events', async (c) => {
  const input = await parseBody(c, createEventSchema)
  return c.json(await createEvent(c.env, input, new Date()), 201)
})

adminRoutes.get('/events/:id', async (c) =>
  c.json(await getAdminEvent(c.env, c.req.param('id'), new Date())),
)

adminRoutes.patch('/events/:id', async (c) => {
  const patch = await parseBody(c, updateEventSchema)
  return c.json(await updateEvent(c.env, c.req.param('id'), patch, new Date()))
})

for (const action of ['publish', 'unpublish', 'close', 'cancel'] as const satisfies EventAction[]) {
  adminRoutes.post(`/events/:id/${action}`, async (c) =>
    c.json(await transitionEvent(c.env, c.req.param('id'), action, new Date())),
  )
}

adminRoutes.get('/reservations', async (c) => {
  const filters = parseQuery(c, adminReservationsQuerySchema)
  return c.json(await listReservations(c.env, filters, new Date()))
})

adminRoutes.get('/reservations.csv', async (c) => {
  const filters = parseQuery(c, adminReservationsQuerySchema)
  const csv = await exportReservationsCsv(c.env, filters, new Date())
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="reservations-nahe.csv"',
  })
})

adminRoutes.post('/reservations/:id/confirm', async (c) => {
  const now = new Date()
  const reservation = await confirmReservation(c.env, c.req.param('id'), now)
  const ticketsEmail = await sendTicketsEmail(c.env, reservation.id, new URL(c.req.url).origin, now)
  return c.json({ ...(await getAdminReservationById(c.env, reservation.id)), ticketsEmail })
})

adminRoutes.post('/reservations/:id/resend-tickets', async (c) => {
  const id = c.req.param('id')
  const reservation = await getAdminReservationById(c.env, id)
  if (reservation.status !== 'confirmed') {
    throw new ApiError(409, 'invalid_transition', 'Seule une réservation confirmée a des billets.')
  }
  const ticketsEmail = await sendTicketsEmail(c.env, id, new URL(c.req.url).origin, new Date(), { force: true })
  return c.json({ ...(await getAdminReservationById(c.env, id)), ticketsEmail })
})

adminRoutes.post('/reservations/:id/cancel', async (c) =>
  c.json(await cancelReservation(c.env, c.req.param('id'), new Date())),
)

adminRoutes.post('/reservations/:id/regenerate-link', async (c) =>
  c.json(await regenerateAccessLink(c.env, c.req.param('id'))),
)

adminRoutes.get('/payment-settings', async (c) =>
  c.json(await getPaymentSettings(getDb(c.env.DB))),
)

adminRoutes.put('/payment-settings', async (c) => {
  const input = await parseBody(c, paymentSettingsSchema)
  return c.json(await savePaymentSettings(getDb(c.env.DB), input, new Date()))
})

adminRoutes.get('/tickets/lookup', async (c) => {
  const { t, eventId } = parseQuery(c, ticketLookupQuerySchema)
  return c.json(await lookupTicket(c.env, t, eventId))
})

adminRoutes.post('/tickets/check-in', async (c) => {
  const { token, eventId } = await parseBody(c, checkInSchema)
  return c.json(await checkInByToken(c.env, token, new Date(), eventId))
})

adminRoutes.post('/tickets/:id/check-in', async (c) =>
  c.json(await checkInTicket(c.env, c.req.param('id'), new Date())),
)

adminRoutes.post('/tickets/:id/undo-check-in', async (c) =>
  c.json(await undoCheckIn(c.env, c.req.param('id'))),
)

adminRoutes.get('/events/:id/tickets', async (c) =>
  c.json(await listEventTickets(c.env, c.req.param('id'))),
)
