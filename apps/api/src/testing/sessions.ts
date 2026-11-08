// Test sessions (FND-11): lets any test act as a signed-in user without the login endpoint, which is
// what allows every team to work independently of the Auth team (TEAMS.md 2.4).
import { randomBytes } from 'node:crypto'
import { hashSessionToken } from '../access/session-token'
import type { Db } from '../db/client'
import { sessions } from '../db/schema'
import { SESSION_COOKIE } from '../http/cookies'
import { createUser } from './factories'

/** The SESSION_SECRET every test app is configured with (see testing/test-app.ts). */
export const TEST_SESSION_SECRET = 'test-session-secret'

export interface TestSession {
  userId: string
  sessionId: string
  /** The raw opaque token (never stored; only its HMAC is). */
  token: string
  /** Value for the `Cookie` request header: `mockbench_session=<token>`. */
  cookie: string
}

export interface CreateTestSessionOptions {
  /** Create an already-expired session (for 401 tests). */
  expired?: boolean
  /** Milliseconds until expiry (default one hour; negative = already expired). */
  ttlMs?: number
  /** Secret to hash with; must match the app under test (default TEST_SESSION_SECRET). */
  secret?: string
  userAgent?: string
}

/**
 * Inserts a live `sessions` row for `userId` and returns the cookie to send. When `userId` is omitted
 * a user is created on demand. Mirrors production storage: only HMAC(token) reaches the database.
 */
export async function createTestSession(
  db: Db,
  userId?: string,
  opts: CreateTestSessionOptions = {},
): Promise<TestSession> {
  const uid = userId ?? (await createUser(db)).id
  const token = randomBytes(32).toString('base64url')
  const ttl = opts.ttlMs ?? (opts.expired ? -60_000 : 3_600_000)
  const [row] = await db
    .insert(sessions)
    .values({
      userId: uid,
      tokenHash: hashSessionToken(token, opts.secret ?? TEST_SESSION_SECRET),
      expiresAt: new Date(Date.now() + ttl),
      userAgent: opts.userAgent ?? 'mockbench-tests',
    })
    .returning({ id: sessions.id })
  return { userId: uid, sessionId: row!.id, token, cookie: `${SESSION_COOKIE}=${token}` }
}
