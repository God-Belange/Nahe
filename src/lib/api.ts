import type { ApiErrorBody } from '../../shared/types'
import { API_ERROR_MESSAGES, fr } from './fr'

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
  }
}

let unauthorizedHandler: (() => void) | null = null
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  unauthorizedHandler = fn
}

let csrfToken: string | null = null
export const setCsrfToken = (token: string | null) => {
  csrfToken = token
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const isBlob = body instanceof Blob
  if (isBlob) headers['Content-Type'] = body.type
  else if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: isBlob ? body : JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiClientError(0, 'network_error', fr.common.networkError)
  }

  if (!res.ok) {
    let payload: ApiErrorBody | null = null
    try {
      payload = (await res.json()) as ApiErrorBody
    } catch {
      /* corps non JSON */
    }
    const code = payload?.error.code ?? 'unknown'
    if (res.status === 401 && code === 'unauthenticated') unauthorizedHandler?.()
    throw new ApiClientError(
      res.status,
      code,
      payload?.error.message ?? API_ERROR_MESSAGES[code] ?? fr.common.genericError,
      payload?.error.fields,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: Blob) => request<T>('POST', path, file),
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : fr.common.genericError
}
