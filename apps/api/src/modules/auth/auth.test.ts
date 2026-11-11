import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { sessions, users, workspaces } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'

const apps: TestApp[] = []
async function app(env: Record<string, string> = {}) {
  const t = await testApp({ env })
  apps.push(t)
  return t
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((t) => t.drop()))
})

const PW = 'correct horse battery'
const reg = (t: TestApp, email = 'a@x.io', password = PW, ip?: string) => {
  const r = t.as().post('/api/v1/auth/register')
  if (ip) r.set('X-Forwarded-For', ip)
  return r.send({ email, password, name: 'Ann' })
}
const login = (t: TestApp, email: string, password: string, ip?: string) => {
  const r = t.as().post('/api/v1/auth/login')
  if (ip) r.set('X-Forwarded-For', ip)
  return r.send({ email, password })
}
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const sc = ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? [])
  const last = sc.filter((c) => c.startsWith('mockbench_session=')).pop()
  return last?.split(';')[0] ?? ''
}

describe('auth.register', () => {
  it('first registration: 201, default workspace as owner, cookie, argon2id hash', async () => {
    const t = await app()
    const res = await reg(t)
    t.assertContract('auth.register', res)
    expect(res.status).toBe(201)
    expect(res.body.workspaces).toHaveLength(1)
    expect(res.body.workspaces[0]).toMatchObject({ slug: 'default', role: 'owner' })
    expect(cookieOf(res)).toMatch(/^mockbench_session=.{20,}/)
    const [u] = await t.db.select().from(users)
    expect(u!.passwordHash.startsWith('$argon2id$')).toBe(true)
  })

  it('joins an ownerless seeded default workspace without creating a second', async () => {
    const t = await app()
    await t.f.createWorkspace({ name: 'Default', slug: 'default' })
    const res = await reg(t)
    expect(res.status).toBe(201)
    expect(res.body.workspaces[0]).toMatchObject({ slug: 'default', role: 'owner' })
    expect(await t.db.select().from(workspaces)).toHaveLength(1)
  })

  it('second registration: 201 with no workspace when signup is allowed', async () => {
    const t = await app()
    await reg(t, 'a@x.io')
    const res = await reg(t, 'b@x.io')
    expect(res.status).toBe(201)
    expect(res.body.workspaces).toEqual([])
  })

  it('ALLOW_SIGNUP=false: 403 once a user exists and no row is created; zero users still succeeds', async () => {
    const t = await app({ ALLOW_SIGNUP: 'false' })
    expect((await reg(t, 'a@x.io')).status).toBe(201)
    const res = await reg(t, 'b@x.io')
    t.assertContract('auth.register', res)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('signup_disabled')
    expect(await t.db.select().from(users)).toHaveLength(1)
  })

  it('two simultaneous first registrations with signup off: one 201, one 403, one default workspace', async () => {
    const t = await app({ ALLOW_SIGNUP: 'false' })
    const [a, b] = await Promise.all([reg(t, 'a@x.io'), reg(t, 'b@x.io')])
    expect([a.status, b.status].sort()).toEqual([201, 403])
    expect(await t.db.select().from(users)).toHaveLength(1)
    const ws = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'default'))
    expect(ws).toHaveLength(1)
  })

  it('email is case-insensitively unique: 409 email_taken, no rows added', async () => {
    const t = await app()
    await reg(t, 'a@x.io')
    const res = await reg(t, 'A@x.io')
    t.assertContract('auth.register', res)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('email_taken')
    expect(await t.db.select().from(users)).toHaveLength(1)
    expect(await t.db.select().from(workspaces)).toHaveLength(1)
  })

  it('rejects 7-char and 129-char passwords with the offending path', async () => {
    const t = await app()
    for (const pw of ['a'.repeat(7), 'a'.repeat(129)]) {
      const res = await reg(t, 'a@x.io', pw)
      expect(res.status).toBe(422)
      expect(res.body.details[0].path).toEqual(['password'])
    }
    expect(await t.db.select().from(users)).toHaveLength(0)
  })
})

describe('auth.login', () => {
  it('wrong password, unknown email and deactivated account give the identical 401', async () => {
    const t = await app()
    await reg(t)
    const wrong = await login(t, 'a@x.io', 'not the password')
    const unknown = await login(t, 'nobody@x.io', PW)
    await t.db.update(users).set({ isActive: false })
    const inactive = await login(t, 'a@x.io', PW)
    for (const r of [wrong, unknown, inactive]) {
      t.assertContract('auth.login', r)
      expect(r.status).toBe(401)
      expect(r.body).toEqual(wrong.body)
      expect(r.body.error).toBe('invalid_credentials')
    }
  })

  it('succeeds with a new cookie and revokes the session the request arrived with', async () => {
    const t = await app()
    const first = await reg(t)
    const oldCookie = cookieOf(first)
    const res = await t
      .as({ cookie: oldCookie })
      .post('/api/v1/auth/login')
      .send({ email: 'a@x.io', password: PW })
    t.assertContract('auth.login', res)
    expect(res.status).toBe(200)
    const fresh = cookieOf(res)
    expect(fresh).not.toBe(oldCookie)
    expect((await t.as({ cookie: oldCookie }).get('/api/v1/auth/me')).status).toBe(401)
    expect((await t.as({ cookie: fresh }).get('/api/v1/auth/me')).status).toBe(200)
  })

  it('unknown email costs about as much as a wrong password (loose bound)', async () => {
    const t = await app()
    await reg(t)
    await login(t, 'nobody@x.io', PW) // warm the dummy hash
    const time = async (email: string) => {
      const s = performance.now()
      for (let i = 0; i < 3; i++) await login(t, email, 'wrong password')
      return performance.now() - s
    }
    const known = await time('a@x.io')
    const unknown = await time('nobody@x.io')
    expect(unknown).toBeGreaterThan(known * 0.4)
    expect(unknown).toBeLessThan(known * 2.5)
  })
})

describe('rate limit', () => {
  it('11th login from one IP in a minute is 429 with Retry-After; another IP is unaffected', async () => {
    const t = await app({ TRUST_PROXY: '1' })
    for (let i = 0; i < 10; i++) {
      expect((await login(t, 'x@x.io', 'whatever', '10.0.0.1')).status).toBe(401)
    }
    const res = await login(t, 'x@x.io', 'whatever', '10.0.0.1')
    t.assertContract('auth.login', res)
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('rate_limited')
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect((await login(t, 'x@x.io', 'whatever', '10.0.0.2')).status).toBe(401)
  })

  it('register shares the same per-IP budget', async () => {
    const t = await app({ TRUST_PROXY: '1', ALLOW_SIGNUP: 'false' })
    await reg(t, 'first@x.io', PW, '10.0.0.9')
    for (let i = 0; i < 9; i++) await reg(t, `u${i}@x.io`, PW, '10.0.0.9')
    expect((await reg(t, 'late@x.io', PW, '10.0.0.9')).status).toBe(429)
  })
})

describe('auth.logout and auth.me', () => {
  it('logout: 204, clears the cookie, deletes the session; again without a cookie is 204', async () => {
    const t = await app()
    const cookie = cookieOf(await reg(t))
    const res = await t.as({ cookie }).post('/api/v1/auth/logout')
    t.assertContract('auth.logout', res)
    expect(res.status).toBe(204)
    expect(String(res.headers['set-cookie'])).toMatch(/mockbench_session=;.*Max-Age=0/)
    expect(await t.db.select().from(sessions)).toHaveLength(0)
    const again = await t.as().post('/api/v1/auth/logout')
    expect(again.status).toBe(204)
  })

  it('me returns the user and every workspace with the role; 401 without a cookie', async () => {
    const t = await app()
    const cookie = cookieOf(await reg(t))
    const extra = await t.f.createWorkspace({ name: 'Zeta' })
    const [u] = await t.db.select().from(users)
    await t.f.createMember({ workspaceId: extra.id, userId: u!.id, role: 'viewer' })
    const res = await t.as({ cookie }).get('/api/v1/auth/me')
    t.assertContract('auth.me', res)
    expect(res.body.user.email).toBe('a@x.io')
    expect(
      res.body.workspaces.map((w: { slug: string; role: string }) => [w.slug, w.role]),
    ).toEqual([
      ['default', 'owner'],
      [extra.slug, 'viewer'],
    ])
    expect((await t.as().get('/api/v1/auth/me')).status).toBe(401)
  })
})

describe('auth.changePassword', () => {
  it('wrong current password is 403 wrong_password; right one is 204, other sessions revoked', async () => {
    const t = await app()
    const cookie = cookieOf(await reg(t))
    const other = cookieOf(await login(t, 'a@x.io', PW))
    const bad = await t
      .as({ cookie })
      .post('/api/v1/auth/password')
      .send({ currentPassword: 'nope nope nope', newPassword: 'a much longer passphrase' })
    t.assertContract('auth.changePassword', bad)
    expect(bad.status).toBe(403)
    expect(bad.body.error).toBe('wrong_password')

    const ok = await t
      .as({ cookie })
      .post('/api/v1/auth/password')
      .send({ currentPassword: PW, newPassword: 'a much longer passphrase' })
    t.assertContract('auth.changePassword', ok)
    expect(ok.status).toBe(204)
    expect((await login(t, 'a@x.io', PW)).status).toBe(401)
    expect((await login(t, 'a@x.io', 'a much longer passphrase')).status).toBe(200)
    expect((await t.as({ cookie }).get('/api/v1/auth/me')).status).toBe(200)
    expect((await t.as({ cookie: other }).get('/api/v1/auth/me')).status).toBe(401)
  })
})

describe('system.instance', () => {
  it('reports allowSignup per env and setupRequired only while no user exists, without a cookie', async () => {
    const t = await app({ ALLOW_SIGNUP: 'false' })
    const before = await t.as().get('/api/v1/instance')
    t.assertContract('system.instance', before)
    expect(before.body).toMatchObject({ allowSignup: false, setupRequired: true })
    await reg(t)
    const after = await t.as().get('/api/v1/instance')
    expect(after.body).toMatchObject({ allowSignup: false, setupRequired: false })
  })
})
