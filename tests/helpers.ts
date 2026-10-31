import { env, exports } from 'cloudflare:workers'
import type { CreateEventInput } from '../shared/schemas'
import type { AdminEventDetail, CreatedReservation, ReservationView } from '../shared/types'
import { createEvent, transitionEvent } from '../worker/services/events'
import { savePaymentSettings } from '../worker/services/settings'
import { getDb } from '../worker/lib/db'

export const TEST_ADMIN_PASSWORD = 'mot-de-passe-de-test'
export const TEST_SCANNER_PASSWORD = 'code-entree-de-test'
const ORIGIN = 'https://nahe.test'

export async function resetDatabase() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tickets'),
    env.DB.prepare('DELETE FROM reservations'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM payment_settings'),
    env.DB.prepare('DELETE FROM email_templates'),
    env.DB.prepare('DELETE FROM images'),
    env.DB.prepare('DELETE FROM admin_sessions'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
}

export interface ApiOptions {
  method?: string
  body?: unknown
  ip?: string
  cookie?: string
  csrf?: string
  origin?: string | null
  raw?: Uint8Array<ArrayBuffer>
  contentType?: string
}

let ipCounter = 0
export const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

export async function api(path: string, opts: ApiOptions = {}) {
  const headers = new Headers({ 'CF-Connecting-IP': opts.ip ?? freshIp() })
  const method = opts.method ?? 'GET'
  if (opts.origin !== null && method !== 'GET') headers.set('Origin', opts.origin ?? ORIGIN)
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json')
  if (opts.raw) headers.set('Content-Type', opts.contentType ?? 'application/octet-stream')
  if (opts.cookie) headers.set('Cookie', opts.cookie)
  if (opts.csrf) headers.set('X-CSRF-Token', opts.csrf)
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.raw ? { body: opts.raw } : {}),
    }),
  )
  const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(await res.arrayBuffer())
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* corps non JSON (CSV) */
  }
  return { status: res.status, headers: res.headers, json, text }
}

export interface AdminSessionData {
  cookie: string
  csrf: string
}

export async function login(ip = freshIp(), password = TEST_ADMIN_PASSWORD): Promise<AdminSessionData> {
  const res = await api('/admin/session', {
    method: 'POST',
    body: { password },
    ip,
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`)
  const setCookie = res.headers.get('Set-Cookie') ?? ''
  const cookie = setCookie.split(';')[0]!
  return { cookie, csrf: res.json.csrfToken }
}

export function adminApi(session: AdminSessionData, path: string, opts: ApiOptions = {}) {
  return api(`/admin${path}`, { ...opts, cookie: session.cookie, csrf: session.csrf })
}

export const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

export function eventInput(overrides: Partial<Record<keyof CreateEventInput, unknown>> = {}) {
  return {
    title: 'Barbecue chez Sam',
    description: 'Viande, légumes et bonne humeur.',
    location: '12 rue des Lilas, Lille',
    startsAt: daysFromNow(30),
    priceCents: 1500,
    capacity: 10,
    visibility: 'public',
    ...overrides,
  }
}

export async function configurePayments() {
  await savePaymentSettings(
    getDb(env.DB),
    {
      weroInstructions: 'Envoyez le montant au 06 12 34 56 78 via Wero.',
      weroQrImageUrl: '/images/wero-qr.svg',
      weroContact: '06 12 34 56 78',
      paypalMeUrl: 'https://paypal.me/samtest',
      revolutMeUrl: 'https://revolut.me/samtest',
      pendingTtlHours: 24,
    },
    new Date(),
  )
}

export async function makeEvent(
  overrides: Partial<Record<keyof CreateEventInput, unknown>> = {},
  publish = true,
): Promise<AdminEventDetail> {
  const { createEventSchema } = await import('../shared/schemas')
  const input = createEventSchema.parse(eventInput(overrides))
  let event = await createEvent(env, input, new Date())
  if (publish) event = await transitionEvent(env, event.id, 'publish', new Date())
  return event
}

let emailCounter = 0
export function reservationBody(overrides: Record<string, unknown> = {}) {
  const quantity = typeof overrides.quantity === 'number' ? overrides.quantity : 1
  return {
    firstName: 'Camille',
    lastName: 'Durand',
    email: `invite${++emailCounter}@example.com`,
    phone: '0612345678',
    quantity: 1,
    guests: Array.from({ length: Math.max(0, quantity - 1) }, (_, i) => ({ firstName: `Invité${i + 2}`, lastName: 'Durand' })),
    paymentMethod: 'wero',
    ...overrides,
  }
}

export async function reserve(eventId: string, overrides: Record<string, unknown> = {}) {
  const res = await api(`/events/${eventId}/reservations`, {
    method: 'POST',
    body: reservationBody(overrides),
  })
  return { ...res, data: res.json as CreatedReservation }
}

/** Réserve puis confirme (via l'API admin). Retourne la réservation, son jeton de suivi et ses billets. */
export async function reserveAndConfirm(
  eventId: string,
  overrides: Record<string, unknown> = {},
  admin?: AdminSessionData,
) {
  const created = await reserve(eventId, overrides)
  if (created.status !== 201) throw new Error(`réservation refusée : ${created.text}`)
  const session = admin ?? (await login())
  const list = await adminApi(session, `/reservations?q=${created.data.reservation.reference}`)
  const id = list.json.items[0].id as string
  const confirm = await adminApi(session, `/reservations/${id}/confirm`, { method: 'POST' })
  const view = await api(`/reservations/${created.data.accessToken}`)
  return { id, accessToken: created.data.accessToken, confirm, view: view.json as ReservationView, session }
}
