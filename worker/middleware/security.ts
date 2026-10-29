import type { MiddlewareHandler } from 'hono'
import { ApiError } from '../lib/errors'
import type { AdminSession } from '../services/auth'

export type AppEnv = {
  Bindings: Env
  Variables: { session?: AdminSession }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  c.header('X-Robots-Tag', 'noindex')
}

/** Rejette toute requête mutante dont l'en-tête Origin ne correspond pas au site (défense CSRF en profondeur). */
export const originCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header('Origin')
    if (origin !== new URL(c.req.url).origin) {
      throw new ApiError(403, 'bad_origin', 'Origine de la requête non autorisée.')
    }
  }
  await next()
}
