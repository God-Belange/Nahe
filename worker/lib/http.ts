import type { Context } from 'hono'
import type { ZodType, z } from 'zod'
import { ApiError } from './errors'

export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  return fields
}

export function validationError(error: z.ZodError) {
  return new ApiError(422, 'validation_error', 'Certains champs sont invalides.', zodFields(error))
}

export async function parseBody<S extends ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'Corps de requête invalide.')
  }
  const result = schema.safeParse(raw)
  if (!result.success) throw validationError(result.error)
  return result.data
}

export function parseQuery<S extends ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) throw validationError(result.error)
  return result.data
}
