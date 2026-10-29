export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export const notFound = (code: string, message: string) => new ApiError(404, code, message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)
