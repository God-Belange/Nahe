import { RETENTION_MONTHS } from '../../shared/constants'
import { getDb } from '../lib/db'
import { expireDueReservations } from './reservations'
import { purgeRateLimits } from './rate-limit'

export interface MaintenanceReport {
  anonymized: number
}

/** Tâche quotidienne (Cron Trigger) : expiration, purge technique, anonymisation après 6 mois. */
export async function runMaintenance(env: Env, now: Date): Promise<MaintenanceReport> {
  const db = getDb(env.DB)
  await expireDueReservations(db, now)
  await purgeRateLimits(env.DB, now)
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?1').bind(now.toISOString()).run()

  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS)

  // Une seule requête (le plan gratuit limite à 50 requêtes D1 par invocation).
  // Le hash de jeton « anonymized-<id> » n'est pas un SHA-256 valide : l'ancien lien de suivi devient inutilisable.
  const result = await env.DB.prepare(
    `UPDATE reservations
     SET first_name = 'Anonyme', last_name = '', email = 'anonyme-' || id || '@anonymise.invalid',
         phone = NULL, access_token_hash = 'anonymized-' || id, idempotency_key = NULL, anonymized_at = ?2
     WHERE anonymized_at IS NULL
       AND event_id IN (SELECT id FROM events WHERE COALESCE(ends_at, starts_at) < ?1)`,
  )
    .bind(cutoff.toISOString(), now.toISOString())
    .run()
  await env.DB.prepare(
    `UPDATE tickets SET status = 'void', voided_at = ?1
     WHERE status = 'valid' AND reservation_id IN (SELECT id FROM reservations WHERE anonymized_at IS NOT NULL)`,
  )
    .bind(now.toISOString())
    .run()
  return { anonymized: result.meta.changes }
}
