// AUTH-01: the session service and the sweeper, against real Postgres with a controllable clock.
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../access/session-token'
import { sessions } from '../../db/schema'
import type { TestDb } from '../../db/testing'
import { withTestDb } from '../../db/testing'
import { createUser } from '../../testing'
import {
  SWEEP_INTERVAL_MS,
  TOUCH_INTERVAL_MS,
  createSessionService,
  startSessionSweeper,
} from './sessions'

const SECRET = 'service-test-secret'
const T0 = new Date('2026-03-01T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

let t: TestDb
let clock = new Date(T0)
const setClock = (d: Date) => {
  clock = d
}
const advance = (ms: number) => setClock(new Date(clock.getTime() + ms))
const service = () =>
  createSessionService({
    db: t.db,
    config: { sessionSecret: SECRET, sessionTtlDays: 30 },
    now: () => clock,
  })

beforeAll(async () => {
  t = await withTestDb()
})
afterAll(() => t?.drop())

const req = (ip?: string, ua?: string) => ({ ip, headers: { 'user-agent': ua } })
const row = async (id: string) => (await t.db.select().from(sessions).where(eq(sessions.id, id)))[0]

describe('issue', () => {
  it('stores only the HMAC of the token: the raw token is in no column', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const issued = await service().issue(user.id, req('192.168.1.31', 'curl/8'))
    const stored = await row(issued.sessionId)
    expect(stored?.tokenHash).toBe(hashSessionToken(issued.token, SECRET))
    expect(stored?.tokenHash).not.toBe(issued.token)
    const found = await t.pool.query(
      'select count(*)::int as n from sessions s where s::text like $1',
      [`%${issued.token}%`],
    )
    expect(found.rows[0].n).toBe(0)
  })

  it('returns a 32-byte base64url token, and a different one every time', async () => {
    const user = await createUser(t.db)
    const a = await service().issue(user.id, req())
    const b = await service().issue(user.id, req())
    for (const token of [a.token, b.token]) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    }
    expect(a.token).not.toBe(b.token)
  })

  it('sets expires_at to now + SESSION_TTL_DAYS and records last_used_at, ip and user agent', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const issued = await service().issue(user.id, req('10.0.0.7', 'Mozilla/5.0'))
    expect(issued.expiresAt.getTime()).toBe(T0.getTime() + 30 * DAY)
    const stored = await row(issued.sessionId)
    expect(stored?.expiresAt.getTime()).toBe(T0.getTime() + 30 * DAY)
    expect(stored?.lastUsedAt.getTime()).toBe(T0.getTime())
    expect(stored?.ip).toBe('10.0.0.7')
    expect(stored?.userAgent).toBe('Mozilla/5.0')
  })

  it('truncates a very long user agent and tolerates a missing ip', async () => {
    const user = await createUser(t.db)
    const issued = await service().issue(user.id, req(undefined, 'x'.repeat(5000)))
    const stored = await row(issued.sessionId)
    expect(stored?.userAgent).toHaveLength(512)
    expect(stored?.ip).toBeNull()
  })
})

describe('revoke and revokeOthers', () => {
  it('revoke deletes one session and is idempotent', async () => {
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    await service().revoke(s.sessionId)
    expect(await row(s.sessionId)).toBeUndefined()
    await expect(service().revoke(s.sessionId)).resolves.toBeUndefined()
  })

  it("revokeOthers deletes every other session of that user and none of another user's", async () => {
    const alice = await createUser(t.db)
    const bob = await createUser(t.db)
    const svc = service()
    const keep = await svc.issue(alice.id, req())
    const other1 = await svc.issue(alice.id, req())
    const other2 = await svc.issue(alice.id, req())
    const bobs = await svc.issue(bob.id, req())

    const removed = await svc.revokeOthers(alice.id, keep.sessionId)
    expect(removed).toBe(2)
    expect(await row(keep.sessionId)).toBeDefined()
    expect(await row(other1.sessionId)).toBeUndefined()
    expect(await row(other2.sessionId)).toBeUndefined()
    expect(await row(bobs.sessionId)).toBeDefined()
  })

  it('revokeOthers with nothing else to remove returns 0', async () => {
    const user = await createUser(t.db)
    const only = await service().issue(user.id, req())
    expect(await service().revokeOthers(user.id, only.sessionId)).toBe(0)
  })
})

describe('touch (sliding expiry, at most once per hour)', () => {
  it('does nothing within the hour (59 minutes)', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    advance(59 * 60 * 1000)
    expect(await service().touch(s.sessionId)).toBe(false)
    const stored = await row(s.sessionId)
    expect(stored?.lastUsedAt.getTime()).toBe(T0.getTime())
    expect(stored?.expiresAt.getTime()).toBe(T0.getTime() + 30 * DAY)
  })

  it('extends expires_at by the TTL and stamps last_used_at after an hour (61 minutes)', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    advance(61 * 60 * 1000)
    expect(await service().touch(s.sessionId)).toBe(true)
    const stored = await row(s.sessionId)
    expect(stored?.lastUsedAt.getTime()).toBe(clock.getTime())
    expect(stored?.expiresAt.getTime()).toBe(clock.getTime() + 30 * DAY)
  })

  it('the boundary is inclusive: exactly one hour refreshes', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    advance(TOUCH_INTERVAL_MS)
    expect(await service().touch(s.sessionId)).toBe(true)
  })

  it('of several concurrent touches exactly one refreshes', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    advance(2 * TOUCH_INTERVAL_MS)
    const results = await Promise.all(Array.from({ length: 8 }, () => service().touch(s.sessionId)))
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('returns false for a session that no longer exists', async () => {
    expect(await service().touch('00000000-0000-7000-8000-000000000000')).toBe(false)
  })
})

describe('sweepExpired', () => {
  it('deletes only rows whose expires_at is in the past', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const svc = service()
    const live = await svc.issue(user.id, req())
    const expired = await svc.issue(user.id, req())
    const justExpired = await svc.issue(user.id, req())
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(T0.getTime() - 24 * 60 * 60 * 1000) })
      .where(eq(sessions.id, expired.sessionId))
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(T0.getTime() - 1) })
      .where(eq(sessions.id, justExpired.sessionId))

    const removed = await svc.sweepExpired()
    expect(removed).toBeGreaterThanOrEqual(2)
    expect(await row(expired.sessionId)).toBeUndefined()
    expect(await row(justExpired.sessionId)).toBeUndefined()
    expect(await row(live.sessionId)).toBeDefined()
  })

  it('keeps a session that expires exactly now', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(T0) })
      .where(eq(sessions.id, s.sessionId))
    await service().sweepExpired()
    expect(await row(s.sessionId)).toBeDefined()
  })
})

describe('startSessionSweeper', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sweeps once at start-up and then on every interval, and stop() ends it', async () => {
    vi.useFakeTimers()
    const sweepExpired = vi.fn().mockResolvedValue(0)
    const stop = startSessionSweeper({ service: { sweepExpired } })
    expect(sweepExpired).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    expect(sweepExpired).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * SWEEP_INTERVAL_MS)
    expect(sweepExpired).toHaveBeenCalledTimes(4)
    stop()
    await vi.advanceTimersByTimeAsync(5 * SWEEP_INTERVAL_MS)
    expect(sweepExpired).toHaveBeenCalledTimes(4)
  })

  it('defaults to hourly', () => {
    expect(SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000)
  })

  it('the timer is unref’d so it never keeps the process alive', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    const stop = startSessionSweeper({ service: { sweepExpired: async () => 0 } })
    const timer = spy.mock.results[0]?.value as NodeJS.Timeout
    expect(timer.hasRef()).toBe(false)
    stop()
  })

  it('logs how many sessions it removed, and a failure without throwing', async () => {
    vi.useFakeTimers()
    const info = vi.fn()
    const error = vi.fn()
    const sweepExpired = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0)
    const stop = startSessionSweeper({ service: { sweepExpired }, logger: { info, error } })
    await vi.advanceTimersByTimeAsync(0)
    expect(info).toHaveBeenCalledWith({ removed: 3 }, 'expired sessions swept')
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    expect(error).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    expect(sweepExpired).toHaveBeenCalledTimes(3)
    stop()
  })

  it('works against the real service and database', async () => {
    setClock(new Date(T0))
    const user = await createUser(t.db)
    const s = await service().issue(user.id, req())
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(T0.getTime() - DAY) })
      .where(eq(sessions.id, s.sessionId))
    const stop = startSessionSweeper({ service: service() })
    await vi.waitFor(async () => expect(await row(s.sessionId)).toBeUndefined())
    stop()
  })
})
