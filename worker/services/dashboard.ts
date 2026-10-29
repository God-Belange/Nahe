import type { DashboardStats } from '../../shared/types'
import { getDb } from '../lib/db'
import { expireDueReservations } from './reservations'

export async function getDashboardStats(env: Env, now: Date): Promise<DashboardStats> {
  const nowIso = now.toISOString()
  await expireDueReservations(getDb(env.DB), now)

  const [events, resa, available, refunds] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN starts_at > ?1 AND status IN ('published','closed') THEN 1 ELSE 0 END), 0) AS upcoming
       FROM events WHERE status <> 'cancelled'`,
    ).bind(nowIso),
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN r.payment_status = 'confirmed' THEN r.quantity ELSE 0 END), 0) AS participants,
         COALESCE(SUM(CASE WHEN r.payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN r.payment_status = 'confirmed' THEN r.total_amount_cents ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN r.payment_status = 'pending' THEN r.total_amount_cents ELSE 0 END), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN r.payment_status = 'pending' AND r.payment_declared_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS declared
       FROM reservations r JOIN events e ON e.id = r.event_id
       WHERE e.status <> 'cancelled'`,
    ),
    env.DB.prepare(
      `SELECT COALESCE(SUM(e.capacity - COALESCE((
         SELECT SUM(r.quantity) FROM reservations r
         WHERE r.event_id = e.id AND r.payment_status IN ('confirmed','pending')
       ), 0)), 0) AS available
       FROM events e WHERE e.status = 'published' AND e.starts_at > ?1`,
    ).bind(nowIso),
    env.DB.prepare(
      `SELECT COALESCE(SUM(r.total_amount_cents), 0) AS refunds
       FROM reservations r JOIN events e ON e.id = r.event_id
       WHERE e.status = 'cancelled' AND r.payment_status = 'confirmed'`,
    ),
  ])

  const e = events?.results[0] as { total: number; upcoming: number }
  const r = resa?.results[0] as {
    participants: number
    pending: number
    collected: number
    outstanding: number
    declared: number
  }
  const a = available?.results[0] as { available: number }
  const f = refunds?.results[0] as { refunds: number }
  return {
    eventsTotal: e.total,
    eventsUpcoming: e.upcoming,
    confirmedParticipants: r.participants,
    pendingReservations: r.pending,
    availablePlaces: a.available,
    collectedCents: r.collected,
    outstandingCents: r.outstanding,
    declaredPayments: r.declared,
    refundsToProcessCents: f.refunds,
  }
}
