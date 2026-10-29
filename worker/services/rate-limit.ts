import { hmacBase64Url } from '../lib/crypto'

/** Fenêtre fixe : incrémente le compteur et renvoie sa nouvelle valeur. */
export async function hitRateLimit(
  d1: D1Database,
  key: string,
  windowMs: number,
  now: Date,
): Promise<number> {
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs
  const row = await d1
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>()
  return row?.count ?? 1
}

export async function peekRateLimit(
  d1: D1Database,
  key: string,
  windowMs: number,
  now: Date,
): Promise<number> {
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs
  const row = await d1
    .prepare('SELECT count FROM rate_limits WHERE key = ?1 AND window_start = ?2')
    .bind(key, windowStart)
    .first<{ count: number }>()
  return row?.count ?? 0
}

/** Clé de limitation : action + IP hachée (HMAC), pour ne jamais stocker l'IP en clair. */
export async function rateLimitKey(env: Env, request: Request, action: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
  return `${action}:${await hmacBase64Url(env.SESSION_SECRET, `ip:${ip}`)}`
}

export async function purgeRateLimits(d1: D1Database, now: Date): Promise<void> {
  const cutoff = now.getTime() - 24 * 3_600_000
  await d1.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff).run()
}
