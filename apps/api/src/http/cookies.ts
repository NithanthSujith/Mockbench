// Cookie helpers. The session cookie convention is API-CONTRACT 1.6: HttpOnly; SameSite=Lax;
// Path=/; no Domain; Secure only when COOKIE_SECURE=true. AUTH-01 owns issuing it; this file only
// provides the primitives and the clearing form the seed session middleware needs.
import { stringifySetCookie } from 'cookie'

export const SESSION_COOKIE = 'mockbench_session'

export interface SessionCookieOptions {
  secure: boolean
  /** Seconds. Omit for a session cookie. */
  maxAgeSec?: number
}

/** `Set-Cookie` value that sets the session cookie. */
export function sessionCookieHeader(value: string, opts: SessionCookieOptions): string {
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    ...(opts.maxAgeSec !== undefined ? { maxAge: opts.maxAgeSec } : {}),
  })
}

/** `Set-Cookie` value that clears the session cookie (Max-Age=0). */
export function clearSessionCookieHeader(opts: { secure: boolean }): string {
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value: '',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    maxAge: 0,
  })
}
