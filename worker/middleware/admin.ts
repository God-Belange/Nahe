import { getCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import { ApiError } from '../lib/errors'
import { authenticateSession, verifyCsrf } from '../services/auth'
import type { AppEnv } from './security'

export const SESSION_COOKIE = 'nahe_session'
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Authentifie la session (tous rôles) et contrôle le CSRF sur les requêtes mutantes. */
const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE, 'host')
  const session = await authenticateSession(c.env, token, new Date())
  if (!session) throw new ApiError(401, 'unauthenticated', 'Connexion requise.')
  if (MUTATING.has(c.req.method) && !(await verifyCsrf(session, c.req.header('X-CSRF-Token')))) {
    throw new ApiError(403, 'bad_csrf', 'Jeton CSRF invalide.')
  }
  c.set('session', session)
  await next()
}

/** Réservé à l'organisateur : le rôle « scanner » reçoit un 403. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  await authenticate(c, async () => {
    if (c.get('session')?.role !== 'admin') throw new ApiError(403, 'forbidden', 'Accès réservé à l\'organisateur.')
    await next()
  })
}

/** Organisateur ou personnel d'entrée : routes de contrôle des billets. */
export const requireStaff: MiddlewareHandler<AppEnv> = authenticate
