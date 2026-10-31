import { and, eq, lt } from 'drizzle-orm'
import { adminSessions } from '../db/schema'
import { hmacBase64Url, randomId, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from '../lib/crypto'
import { getDb } from '../lib/db'

export const SESSION_TTL_SECONDS = 12 * 3600
export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60_000

export type SessionRole = 'admin' | 'scanner'

/** Le code saisi détermine le rôle : mot de passe organisateur, sinon code d'accès « scanner » s'il est configuré. */
export async function resolveLoginRole(env: Env, password: string): Promise<SessionRole | null> {
  if (env.ADMIN_PASSWORD_HASH && (await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) return 'admin'
  if (env.SCANNER_PASSWORD_HASH && (await verifyPassword(password, env.SCANNER_PASSWORD_HASH))) return 'scanner'
  return null
}

/** Le jeton CSRF est dérivé de la session (HMAC) : réémissible sans être stocké en clair. */
function deriveCsrfToken(env: Env, sessionToken: string): Promise<string> {
  return hmacBase64Url(env.SESSION_SECRET, `csrf:${sessionToken}`)
}

export async function createSession(env: Env, now: Date, role: SessionRole) {
  const db = getDb(env.DB)
  const sessionToken = randomToken(32)
  const csrfToken = await deriveCsrfToken(env, sessionToken)
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString()
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now.toISOString()))
  await db.insert(adminSessions).values({
    id: randomId(),
    sessionTokenHash: await sha256Hex(sessionToken),
    csrfTokenHash: await sha256Hex(csrfToken),
    role,
    expiresAt,
    createdAt: now.toISOString(),
  })
  return { sessionToken, csrfToken, expiresAt, role }
}

export interface AdminSession {
  id: string
  role: SessionRole
  csrfTokenHash: string
  csrfToken: string
}

export async function authenticateSession(
  env: Env,
  sessionToken: string | undefined,
  now: Date,
): Promise<AdminSession | null> {
  if (!sessionToken) return null
  const db = getDb(env.DB)
  const row = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.sessionTokenHash, await sha256Hex(sessionToken)))
    .get()
  if (!row || row.expiresAt <= now.toISOString()) return null
  return {
    id: row.id,
    role: row.role,
    csrfTokenHash: row.csrfTokenHash,
    csrfToken: await deriveCsrfToken(env, sessionToken),
  }
}

export async function verifyCsrf(session: AdminSession, header: string | undefined): Promise<boolean> {
  if (!header) return false
  return timingSafeEqual(await sha256Hex(header), session.csrfTokenHash)
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
  const db = getDb(env.DB)
  await db.delete(adminSessions).where(and(eq(adminSessions.id, sessionId)))
}
