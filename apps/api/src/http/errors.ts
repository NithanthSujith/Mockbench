// The only way to emit a control-plane error (CLAUDE.md "Conventions"): throw an HttpError and let
// the control-plane error handler turn it into the envelope `{ error, message, details }`.

export interface ErrorBody {
  error: string
  message: string
  /** ALWAYS an array (API-CONTRACT 1.3). */
  details: unknown[]
}

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown[]
  /** Extra response headers (e.g. `Retry-After` on 429). */
  readonly headers: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown[] = [],
    headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError
}

export function errorBody(code: string, message: string, details: unknown[] = []): ErrorBody {
  return { error: code, message, details }
}
