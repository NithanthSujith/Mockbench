import { HttpError } from './errors'
import type { ApiContext, AuthInfo } from './types'

/** Returns the caller, or throws 401: for handlers of non-public endpoints. */
export function authOf(ctx: ApiContext): AuthInfo {
  if (!ctx.auth) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return ctx.auth
}
