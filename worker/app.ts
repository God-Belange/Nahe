import { Hono } from 'hono'
import { ZodError } from 'zod'
import { ApiError } from './lib/errors'
import { zodFields } from './lib/http'
import { originCheck, securityHeaders, type AppEnv } from './middleware/security'
import { adminRoutes, sessionRoutes } from './routes/admin'
import { publicRoutes } from './routes/public'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', securityHeaders)
app.use('*', originCheck)

app.route('/admin/session', sessionRoutes)
app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'Ressource introuvable.' } }, 404),
)

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
      err.status,
    )
  }
  if (err instanceof ZodError) {
    return c.json(
      { error: { code: 'validation_error', message: 'Certains champs sont invalides.', fields: zodFields(err) } },
      422,
    )
  }
  // Journal volontairement sans données personnelles : uniquement le type et le message technique.
  console.error('Unhandled error', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown')
  return c.json({ error: { code: 'internal_error', message: 'Une erreur est survenue.' } }, 500)
})
