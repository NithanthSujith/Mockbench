// AUTH-01: the session middleware through the real Express app (testApp), against real Postgres.
import { exampleAuthState } from '@mockbench/api-contract'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { sessions, users } from '../../db/schema'
import type { AuthInfo } from '../../http/types'
import type { ApiContext } from '../../http/types'
import type { ModuleMap } from '..'
import { modules } from '..'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'

let seen: AuthInfo | null | undefined | 'unset' = 'unset'

// Test-only module: `auth.me` (needs a session) and `auth.logout` (public, so only the optional step
// runs) both report what the middleware attached.
const probe = {
  system: modules.system,
  probe: {
    areas: ['auth'],
    handlers: {
      'auth.me': async (ctx: ApiContext) => {
        seen = ctx.auth
        return { status: 200, body: exampleAuthState }
      },
      'auth.logout': async (ctx: ApiContext) => {
        seen = ctx.auth
        return { status: 204 }
      },
    },
  },
} as unknown as ModuleMap

const DAY = 24 * 60 * 60 * 1000
const MIN = 60 * 1000

let t: TestApp // defaults: COOKIE_SECURE=false, SESSION_TTL_DAYS=30
let secure: TestApp // COOKIE_SECURE=true, SESSION_TTL_DAYS=7

beforeAll(async () => {
  t = await testApp({ modules: probe })
  secure = await testApp({
    modules: probe,
    env: { COOKIE_SECURE: 'true', SESSION_TTL_DAYS: '7' },
  })
})
afterAll(async () => {
  await t?.drop()
  await secure?.drop()
})
afterEach(() => vi.restoreAllMocks())

const setCookies = (res: { headers: Record<string, unknown> }): string[] =>
  (res.headers['set-cookie'] as string[] | undefined) ?? []
const attrs = (header: string) => header.split(';').map((p) => p.trim())

/** Moves a session's `last_used_at` into the past and gives it a short expiry so a refresh is visible. */
async function age(app: TestApp, sessionId: string, idleMs: number) {
  await app.db
    .update(sessions)
    .set({
      lastUsedAt: new Date(Date.now() - idleMs),
      expiresAt: new Date(Date.now() + DAY),
    })
    .where(eq(sessions.id, sessionId))
}
const rowOf = async (app: TestApp, id: string) =>
  (await app.db.select().from(sessions).where(eq(sessions.id, id)))[0]!

describe('valid sessions', () => {
  it('sets req.auth = { userId, sessionId } and sends no Set-Cookie when recently used', async () => {
    const s = await t.session()
    seen = 'unset'
    const res = await t.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(200)
    expect(seen).toEqual({ userId: s.userId, sessionId: s.sessionId })
    expect(setCookies(res)).toEqual([])
  })

  it('also attaches the session on a public endpoint', async () => {
    const s = await t.session()
    seen = 'unset'
    const res = await t.as(s).post('/api/v1/auth/logout')
    expect(res.status).toBe(204)
    expect(seen).toEqual({ userId: s.userId, sessionId: s.sessionId })
  })
})

describe('invalid sessions: 401 and the cookie is cleared', () => {
  async function expectCleared(app: TestApp, cookie: string, expectSecure: boolean) {
    const res = await app.as({ cookie }).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthenticated')
    const cookies = setCookies(res)
    expect(cookies).toHaveLength(1) // cleared once, never twice
    const parts = attrs(cookies[0]!)
    expect(parts[0]).toBe('mockbench_session=')
    expect(parts).toContain('Max-Age=0')
    expect(parts).toContain('HttpOnly')
    expect(parts).toContain('SameSite=Lax')
    expect(parts).toContain('Path=/')
    expect(parts.some((p) => p.startsWith('Domain'))).toBe(false)
    expect(parts.includes('Secure')).toBe(expectSecure)
  }

  it('an expired session', async () => {
    const s = await t.session(undefined, { expired: true })
    await expectCleared(t, s.cookie, false)
  })

  it('a revoked session (row deleted)', async () => {
    const s = await t.session()
    await t.db.delete(sessions).where(eq(sessions.id, s.sessionId))
    await expectCleared(t, s.cookie, false)
  })

  it('a token that was never issued', async () => {
    await expectCleared(t, 'mockbench_session=' + 'A'.repeat(43), false)
  })

  it('a tampered token', async () => {
    const s = await t.session()
    await expectCleared(t, s.cookie.slice(0, -1) + (s.cookie.endsWith('A') ? 'B' : 'A'), false)
  })

  it('carries Secure when COOKIE_SECURE=true', async () => {
    const s = await secure.session(undefined, { expired: true })
    await expectCleared(secure, s.cookie, true)
  })

  it('no cookie at all is 401 without any Set-Cookie', async () => {
    const res = await t.as().get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(setCookies(res)).toEqual([])
  })

  it('a dead cookie on a public endpoint: the handler still runs, with no auth, and the cookie is cleared', async () => {
    const s = await t.session(undefined, { expired: true })
    seen = 'unset'
    const res = await t.as(s).post('/api/v1/auth/logout')
    expect(res.status).toBe(204)
    expect(seen).toBeNull()
    const cookies = setCookies(res)
    expect(cookies).toHaveLength(1)
    expect(attrs(cookies[0]!)).toContain('Max-Age=0')
  })
})

describe('deactivated users', () => {
  it('a session belonging to a user with is_active = false is 401 and clears the cookie', async () => {
    const s = await t.session()
    expect((await t.as(s).get('/api/v1/auth/me')).status).toBe(200)

    await t.db.update(users).set({ isActive: false }).where(eq(users.id, s.userId))
    const res = await t.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthenticated')
    expect(attrs(setCookies(res)[0]!)).toContain('Max-Age=0')

    // Public endpoints do not treat the user as signed in either.
    seen = 'unset'
    await t.as(s).post('/api/v1/auth/logout')
    expect(seen).toBeNull()

    await t.db.update(users).set({ isActive: true }).where(eq(users.id, s.userId))
    expect((await t.as(s).get('/api/v1/auth/me')).status).toBe(200)
  })
})

describe('sliding expiry', () => {
  it('at 61 minutes idle: extends expires_at by the TTL and re-sends the cookie with the same token', async () => {
    const s = await t.session()
    await age(t, s.sessionId, 61 * MIN)
    const before = Date.now()
    const res = await t.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(200)

    const cookies = setCookies(res)
    expect(cookies).toHaveLength(1)
    const parts = attrs(cookies[0]!)
    expect(parts[0]).toBe(`mockbench_session=${s.token}`)
    expect(parts).toContain(`Max-Age=${30 * 24 * 60 * 60}`) // SESSION_TTL_DAYS (30) in seconds
    expect(parts).toContain('HttpOnly')
    expect(parts).toContain('SameSite=Lax')
    expect(parts).toContain('Path=/')
    expect(parts).not.toContain('Secure')
    expect(parts.some((p) => p.startsWith('Domain'))).toBe(false)

    const stored = await rowOf(t, s.sessionId)
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 1000)
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000)
    expect(stored.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('at 59 minutes idle: no cookie and no write to the database', async () => {
    const s = await t.session()
    await age(t, s.sessionId, 59 * MIN)
    const before = await rowOf(t, s.sessionId)

    const statements: string[] = []
    const query = t.pool.query.bind(t.pool) as (...args: unknown[]) => unknown
    vi.spyOn(t.pool, 'query').mockImplementation(((...args: unknown[]) => {
      const first = args[0]
      statements.push(typeof first === 'string' ? first : ((first as { text?: string }).text ?? ''))
      return query(...args)
    }) as never)

    const res = await t.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(200)
    expect(setCookies(res)).toEqual([])
    expect(statements.length).toBeGreaterThan(0) // the lookup itself happened
    expect(statements.filter((q) => /^\s*(update|insert|delete)\b/i.test(q))).toEqual([])

    const after = await rowOf(t, s.sessionId)
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime())
    expect(after.lastUsedAt.getTime()).toBe(before.lastUsedAt.getTime())
  })

  it('honours COOKIE_SECURE and SESSION_TTL_DAYS on the refreshed cookie', async () => {
    const s = await secure.session()
    await age(secure, s.sessionId, 2 * 60 * MIN)
    const res = await secure.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(200)
    const parts = attrs(setCookies(res)[0]!)
    expect(parts).toContain('Secure')
    expect(parts).toContain(`Max-Age=${7 * 24 * 60 * 60}`)
    expect(parts).toContain('HttpOnly')
    expect(parts).toContain('SameSite=Lax')
    expect(parts.some((p) => p.startsWith('Domain'))).toBe(false)
  })

  it('of several concurrent requests on a stale session, exactly one re-sends the cookie', async () => {
    const s = await t.session()
    await age(t, s.sessionId, 3 * 60 * MIN)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => t.as(s).get('/api/v1/auth/me')),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(results.filter((r) => setCookies(r).length === 1)).toHaveLength(1)
  })

  it('a refreshed session stays quiet on the next request', async () => {
    const s = await t.session()
    await age(t, s.sessionId, 90 * MIN)
    expect(setCookies(await t.as(s).get('/api/v1/auth/me'))).toHaveLength(1)
    expect(setCookies(await t.as(s).get('/api/v1/auth/me'))).toEqual([])
  })
})

describe('the seeded contract is unchanged', () => {
  it('req.auth is { userId: string; sessionId: string }', () => {
    expectTypeOf<AuthInfo>().toEqualTypeOf<{ userId: string; sessionId: string }>()
    expectTypeOf<Express.Request['auth']>().toEqualTypeOf<AuthInfo | undefined>()
  })
})
