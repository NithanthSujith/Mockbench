// Session middleware (AUTH-01). Contract other modules rely on, unchanged since the FND-10 seed:
//   req.auth = { userId, sessionId }   when the `mockbench_session` cookie resolves to a live session.
//
// Two flavours, used by the control plane:
//   optionalSession  - never rejects; sets req.auth when valid. A cookie that does NOT resolve (unknown,
//                      expired, revoked, deactivated user) is cleared on the response right away, so a
//                      browser never keeps sending a dead token; public endpoints such as login may
//                      append a fresh cookie after it (the last Set-Cookie for the name wins).
//   requireSession   - 401 unauthenticated when there is no valid session.
//
// Sliding expiry: a session not touched for an hour is refreshed on its next request (expiry extended
// by SESSION_TTL_DAYS) and the cookie is re-sent with the full Max-Age. Within the hour the request
// performs no write.
import { and, eq, gt } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import type { Config } from '../../config'
import type { Db } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { SESSION_COOKIE } from '../../http/cookies'
import { HttpError } from '../../http/errors'
import type { AuthInfo } from '../../http/types'
import { clearSessionCookie, setSessionCookie } from './cookies'
import { TOUCH_INTERVAL_MS, createSessionService } from './sessions'

export interface SessionAuthDeps {
  db: Db
  config: Pick<Config, 'sessionSecret' | 'cookieSecure' | 'sessionTtlDays'>
  /** Injectable clock for tests. Defaults to the real time. */
  now?: () => Date
}

export interface ResolvedSession {
  auth: AuthInfo
  /** True when this call extended the session; the caller must re-send the cookie. */
  refreshed: boolean
}

export function createSessionAuth(deps: SessionAuthDeps) {
  const now = deps.now ?? (() => new Date())
  const service = createSessionService({
    db: deps.db,
    config: deps.config,
    now,
  })

  /**
   * Looks the token up. Null when absent, unknown, expired, revoked, or the user is deactivated.
   * A live session idle for an hour or more is refreshed (one UPDATE, guarded against races).
   */
  async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token) return null
    const t = now()
    const rows = await deps.db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, service.hash(token)),
          gt(sessions.expiresAt, t),
          eq(users.isActive, true),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    const stale = t.getTime() - row.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS
    const refreshed = stale ? await service.touch(row.sessionId) : false
    return { auth: { userId: row.userId, sessionId: row.sessionId }, refreshed }
  }

  /** Auth info only (the FND-10 signature). */
  async function resolve(token: string | undefined): Promise<AuthInfo | null> {
    return (await resolveSession(token))?.auth ?? null
  }

  /** Resolves the request's cookie onto `req.auth`, re-sending or clearing the cookie as needed. */
  async function attach(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE]
    if (!token) return
    const resolved = await resolveSession(token)
    if (resolved) {
      req.auth = resolved.auth
      if (resolved.refreshed) setSessionCookie(res, token, deps.config)
    } else {
      req.sessionCookieRejected = true
      clearSessionCookie(res, deps.config)
    }
  }

  async function optionalSession(req: Request, res: Response, next: NextFunction) {
    await attach(req, res)
    next()
  }

  /** The 401 for a request that reached a non-public endpoint without a live session. */
  function unauthenticated(res: Response, req: Request): HttpError {
    // The cookie was already cleared when it was rejected; clear it here only when the optional
    // step did not run for this request.
    if (req.cookies?.[SESSION_COOKIE] && !req.sessionCookieRejected) {
      req.sessionCookieRejected = true
      clearSessionCookie(res, deps.config)
    }
    return new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  }

  async function requireSession(req: Request, res: Response, next: NextFunction) {
    // The optional step normally ran first; only resolve here when it did not (and never twice for a
    // cookie it already rejected, which would clear it a second time).
    if (!req.auth && !req.sessionCookieRejected) await attach(req, res)
    if (!req.auth) throw unauthenticated(res, req)
    next()
  }

  return { resolve, resolveSession, optionalSession, requireSession, unauthenticated, service }
}

export type SessionAuth = ReturnType<typeof createSessionAuth>
