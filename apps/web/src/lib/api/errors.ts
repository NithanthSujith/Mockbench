/** One entry of the error envelope's `details` array (API-CONTRACT 1.3). */
export type ApiErrorDetail = unknown

/**
 * Thrown for every non-2xx response and for network failures.
 * `code` is the envelope's machine code (`slug_taken`, `unauthenticated`, ...); clients branch on it,
 * never on `message`. `status` is 0 when the request never got a response.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorDetail[]

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

/** Builds an ApiError from a failed response, tolerating bodies that are not the envelope. */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  let parsed: unknown
  try {
    const text = await res.text()
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof (parsed as { error?: unknown }).error === 'string'
  ) {
    const env = parsed as { error: string; message?: unknown; details?: unknown }
    return new ApiError(
      res.status,
      env.error,
      typeof env.message === 'string' ? env.message : res.statusText || `HTTP ${res.status}`,
      Array.isArray(env.details) ? env.details : [],
    )
  }
  return new ApiError(res.status, `http_${res.status}`, res.statusText || `HTTP ${res.status}`)
}
