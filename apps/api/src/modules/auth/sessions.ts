// Session lifecycle (AUTH-01): issue, revoke, revoke-all-but-current, sliding-expiry touch, sweep.
// Storage is the `sessions` table; only an HMAC of the opaque token is stored (D8, ADR 0003), so a
// database leak cannot be replayed as cookies. The raw token exists only in the Set-Cookie header.
import { randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { and, eq, lt, lte, ne } from 'drizzle-orm'
import { createTokenHasher } from '../../access/session-token'
import type { Config } from '../../config'
import type { Db } from '../../db/client'
import { sessions } from '../../db/schema'

/** A session is refreshed (expiry extended, cookie re-sent) at most once per this interval. */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000
/** How often the sweeper deletes expired sessions. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000

const MAX_USER_AGENT = 512

export interface SessionServiceDeps {
  db: Db
  config: Pick<Config, 'sessionSecret' | 'sessionTtlDays'>
  /** Injectable clock for tests. Defaults to the real time. */
  now?: () => Date
}

/** The parts of an Express request `issue` records. */
export interface SessionRequestMeta {
  ip?: string | undefined
  headers: Pick<IncomingHttpHeaders, 'user-agent'>
}

export interface IssuedSession {
  /** The raw opaque token: 32 random bytes, base64url. Send it once, in the cookie. */
  token: string
  sessionId: string
  expiresAt: Date
}

export function createSessionService(deps: SessionServiceDeps) {
  const { db, config } = deps
  const now = deps.now ?? (() => new Date())
  const hash = createTokenHasher(config.sessionSecret)
  const ttlMs = config.sessionTtlDays * 24 * 60 * 60 * 1000

  return {
    hash,

    async issue(userId: string, req: SessionRequestMeta): Promise<IssuedSession> {
      const token = randomBytes(32).toString('base64url')
      const t = now()
      const expiresAt = new Date(t.getTime() + ttlMs)
      const userAgent = req.headers['user-agent']
      const [row] = await db
        .insert(sessions)
        .values({
          userId,
          tokenHash: hash(token),
          expiresAt,
          lastUsedAt: t,
          userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT) : null,
          ip: req.ip ?? null,
        })
        .returning({ id: sessions.id })
      return { token, sessionId: row!.id, expiresAt }
    },

    /** Deletes one session. Idempotent. */
    async revoke(sessionId: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.id, sessionId))
    },

    /** Deletes every session of `userId` except `keepSessionId`; returns how many were removed. */
    async revokeOthers(userId: string, keepSessionId: string): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
        .returning({ id: sessions.id })
      return rows.length
    },

    /**
     * Sliding expiry: extends `expires_at` by the TTL and stamps `last_used_at`, but only when the
     * session has not been touched within TOUCH_INTERVAL_MS. The guard is part of the UPDATE, so of
     * several concurrent requests exactly one refreshes (and re-sends the cookie). Returns whether
     * this call refreshed the session.
     */
    async touch(sessionId: string): Promise<boolean> {
      const t = now()
      const rows = await db
        .update(sessions)
        .set({ lastUsedAt: t, expiresAt: new Date(t.getTime() + ttlMs) })
        .where(
          and(
            eq(sessions.id, sessionId),
            lte(sessions.lastUsedAt, new Date(t.getTime() - TOUCH_INTERVAL_MS)),
          ),
        )
        .returning({ id: sessions.id })
      return rows.length === 1
    },

    /** Deletes sessions whose `expires_at` is in the past; returns how many. */
    async sweepExpired(): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, now()))
        .returning({ id: sessions.id })
      return rows.length
    },
  }
}

export type SessionService = ReturnType<typeof createSessionService>

export interface SweeperLogger {
  info(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

export interface SessionSweeperDeps {
  service: Pick<SessionService, 'sweepExpired'>
  logger?: SweeperLogger
  intervalMs?: number
}

/**
 * Deletes expired sessions once at start-up and then every hour. The timer is unref'd so it never
 * keeps the process alive, and the returned function stops it (call it on shutdown). A failed sweep
 * is logged and retried on the next tick; it never throws into the event loop.
 */
export function startSessionSweeper(deps: SessionSweeperDeps): () => void {
  const run = () => {
    deps.service.sweepExpired().then(
      (removed) => {
        if (removed > 0) deps.logger?.info({ removed }, 'expired sessions swept')
      },
      (err: unknown) => deps.logger?.error({ err }, 'session sweep failed'),
    )
  }
  run()
  const timer = setInterval(run, deps.intervalMs ?? SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
