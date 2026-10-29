import { and, eq, lt } from 'drizzle-orm'
import { adminSessions } from '../db/schema'
import { hmacBase64Url, randomId, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from '../lib/crypto'
import { getDb } from '../lib/db'

export const SESSION_TTL_SECONDS = 12 * 3600
export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60_000

export async function checkAdminPassword(env: Env, password: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD_HASH) return false
  return verifyPassword(password, env.ADMIN_PASSWORD_HASH)
}

/** Le jeton CSRF est dérivé de la session (HMAC) : réémissible sans être stocké en clair. */
function deriveCsrfToken(env: Env, sessionToken: string): Promise<string> {
  return hmacBase64Url(env.SESSION_SECRET, `csrf:${sessionToken}`)
}

export async function createSession(env: Env, now: Date) {
  const db = getDb(env.DB)
  const sessionToken = randomToken(32)
  const csrfToken = await deriveCsrfToken(env, sessionToken)
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString()
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now.toISOString()))
  await db.insert(adminSessions).values({
    id: randomId(),
    sessionTokenHash: await sha256Hex(sessionToken),
    csrfTokenHash: await sha256Hex(csrfToken),
    expiresAt,
    createdAt: now.toISOString(),
  })
  return { sessionToken, csrfToken, expiresAt }
}

export interface AdminSession {
  id: string
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
