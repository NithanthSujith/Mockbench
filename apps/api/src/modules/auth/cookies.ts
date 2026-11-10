// Session cookie helpers (API-CONTRACT 1.6): HttpOnly; SameSite=Lax; Path=/; no Domain; Secure only
// when COOKIE_SECURE=true; Max-Age = SESSION_TTL_DAYS in seconds. They APPEND to Set-Cookie (never
// overwrite), so a later handler can replace the clearing header a rejected cookie caused earlier.
import type { Response } from 'express'
import type { Config } from '../../config'
import { clearSessionCookieHeader, sessionCookieHeader } from '../../http/cookies'

export type CookieConfig = Pick<Config, 'cookieSecure' | 'sessionTtlDays'>

export function sessionCookieMaxAgeSec(config: Pick<Config, 'sessionTtlDays'>): number {
  return config.sessionTtlDays * 24 * 60 * 60
}

/** Sets (or refreshes) the session cookie with the full TTL as Max-Age. */
export function setSessionCookie(res: Response, token: string, config: CookieConfig): void {
  res.append(
    'Set-Cookie',
    sessionCookieHeader(token, {
      secure: config.cookieSecure,
      maxAgeSec: sessionCookieMaxAgeSec(config),
    }),
  )
}

/** Clears the session cookie (Max-Age=0). */
export function clearSessionCookie(res: Response, config: Pick<Config, 'cookieSecure'>): void {
  res.append('Set-Cookie', clearSessionCookieHeader({ secure: config.cookieSecure }))
}
