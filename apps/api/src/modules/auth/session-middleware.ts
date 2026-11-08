// SEED of the session middleware (FND-10), read path only. AUTH-01 owns and hardens this file
// (sliding expiry, revoke, sweeping) and must keep the contract other modules rely on:
//   req.auth = { userId, sessionId }   when the `mockbench_session` cookie resolves to a live session.
//
// Two flavours, used by the control plane:
//   optionalSession  - never rejects; sets req.auth when valid (public endpoints such as login/logout
//                      need to know the current session, but must not fail without one)
//   requireSession   - 401 unauthenticated (and clears the cookie) when there is no valid session
import { and, eq, gt, sql } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { createTokenHasher } from '../../access/session-token'
import type { Config } from '../../config'
import type { Db } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { SESSION_COOKIE, clearSessionCookieHeader } from '../../http/cookies'
import { HttpError } from '../../http/errors'
import type { AuthInfo } from '../../http/types'

export interface SessionAuthDeps {
  db: Db
  config: Pick<Config, 'sessionSecret' | 'cookieSecure'>
}

export function createSessionAuth(deps: SessionAuthDeps) {
  const hash = createTokenHasher(deps.config.sessionSecret)

  /** Looks the cookie up. Returns null when absent, unknown, expired, or the user is deactivated. */
  async function resolve(token: string | undefined): Promise<AuthInfo | null> {
    if (!token) return null
    const rows = await deps.db
      .select({ sessionId: sessions.id, userId: sessions.userId })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hash(token)),
          gt(sessions.expiresAt, sql`now()`),
          eq(users.isActive, true),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  }

  async function optionalSession(req: Request, _res: Response, next: NextFunction) {
    const token = req.cookies?.[SESSION_COOKIE]
    const auth = await resolve(token)
    if (auth) req.auth = auth
    else if (token) req.sessionCookieRejected = true
    next()
  }

  /** Throws the 401 for a request that reached a non-public endpoint without a live session. */
  function unauthenticated(res: Response, req: Request): HttpError {
    if (req.sessionCookieRejected) {
      res.append('Set-Cookie', clearSessionCookieHeader({ secure: deps.config.cookieSecure }))
    }
    return new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  }

  async function requireSession(req: Request, res: Response, next: NextFunction) {
    if (!req.auth) {
      const auth = await resolve(req.cookies?.[SESSION_COOKIE])
      if (auth) req.auth = auth
    }
    if (!req.auth) throw unauthenticated(res, req)
    next()
  }

  return { resolve, optionalSession, requireSession, unauthenticated }
}

export type SessionAuth = ReturnType<typeof createSessionAuth>
