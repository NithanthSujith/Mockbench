// AUTH-04: operator password reset, through `main()` against a real test database.
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { sessions, users } from '../../db/schema'
import { resetPassword, ResetPasswordError } from '../../modules/auth/reset-password'
import { withTestDb } from '../../db/testing'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import { generatePassword, main } from '../reset-password'

const apps: TestApp[] = []
async function app() {
  const t = await testApp()
  apps.push(t)
  return t
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((t) => t.drop()))
})

const PW = 'correct horse battery'
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const sc = ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? [])
  return (
    sc
      .filter((c) => c.startsWith('mockbench_session='))
      .pop()
      ?.split(';')[0] ?? ''
  )
}
const register = (t: TestApp, email: string) =>
  t.as().post('/api/v1/auth/register').send({ email, password: PW, name: 'Ann' })
const login = (t: TestApp, email: string, password: string) =>
  t.as().post('/api/v1/auth/login').send({ email, password })
const me = (t: TestApp, cookie: string) => t.as({ cookie }).get('/api/v1/auth/me')
const env = (t: TestApp) => ({ DATABASE_URL: t.url })
const stdinOf = (s: string) => () => Promise.resolve(s)
const hashOf = async (t: TestApp, email: string) =>
  (await t.db.select().from(users).where(eq(users.email, email)))[0]!.passwordHash

describe('reset-password <email>', () => {
  it('matches the email case-insensitively, prints a 20-character password once, and it logs in', async () => {
    const t = await app()
    expect((await register(t, 'A@x.io')).status).toBe(201)

    const res = await main(env(t), ['a@x.io'], stdinOf('unused'))
    expect(res.code).toBe(0)
    expect(res.stderr).toBeUndefined()
    const m = /^reset-password: new password for a@x\.io: (\S+)$/.exec(res.stdout ?? '')
    expect(m).not.toBeNull()
    const pw = m![1]!
    expect(pw).toHaveLength(20)
    expect(res.stdout!.split(pw)).toHaveLength(2)

    const ok = await login(t, 'A@x.io', pw)
    t.assertContract('auth.login', ok)
    expect(ok.status).toBe(200)
    const old = await login(t, 'A@x.io', PW)
    expect(old.status).toBe(401)
    expect(old.body.error).toBe('invalid_credentials')
  })

  it("deletes every session of that user and no one else's", async () => {
    const t = await app()
    const a1 = cookieOf(await register(t, 'a@x.io'))
    const a2 = cookieOf(await login(t, 'a@x.io', PW))
    const b = cookieOf(await register(t, 'b@x.io'))
    expect((await me(t, a1)).status).toBe(200)

    expect((await main(env(t), ['a@x.io'])).code).toBe(0)

    expect((await me(t, a1)).status).toBe(401)
    expect((await me(t, a2)).status).toBe(401)
    expect((await me(t, b)).status).toBe(200)
    const [a] = await t.db.select().from(users).where(eq(users.email, 'a@x.io'))
    expect(await t.db.select().from(sessions).where(eq(sessions.userId, a!.id))).toHaveLength(0)
  })

  it('does not reactivate a deactivated user', async () => {
    const t = await app()
    await register(t, 'a@x.io')
    await t.db.update(users).set({ isActive: false }).where(eq(users.email, 'a@x.io'))
    expect((await main(env(t), ['a@x.io'])).code).toBe(0)
    const [a] = await t.db.select().from(users).where(eq(users.email, 'a@x.io'))
    expect(a!.isActive).toBe(false)
  })
})

describe('reset-password <email> --password-stdin', () => {
  it('sets the piped password (one trailing newline stripped) and prints no password', async () => {
    const t = await app()
    await register(t, 'a@x.io')
    const res = await main(env(t), ['a@x.io', '--password-stdin'], stdinOf('new secret pw\n'))
    expect(res.code).toBe(0)
    expect(res.stdout).not.toContain('new secret pw')
    expect((await login(t, 'a@x.io', 'new secret pw')).status).toBe(200)
  })

  it('a 7-character password: exit 1, nothing changed', async () => {
    const t = await app()
    const cookie = cookieOf(await register(t, 'a@x.io'))
    const before = await hashOf(t, 'a@x.io')
    const res = await main(env(t), ['--password-stdin', 'a@x.io'], stdinOf('1234567'))
    expect(res).toEqual({
      code: 1,
      stderr: 'reset-password: failed: password must be 8-128 characters',
    })
    expect(await hashOf(t, 'a@x.io')).toBe(before)
    expect((await me(t, cookie)).status).toBe(200)
  })

  it('a 129-character password: exit 1', async () => {
    const t = await app()
    await register(t, 'a@x.io')
    const res = await main(env(t), ['a@x.io', '--password-stdin'], stdinOf('x'.repeat(129)))
    expect(res.code).toBe(1)
  })
})

describe('reset-password failures', () => {
  it('unknown email: exit 1, one line, no rows changed', async () => {
    const t = await app()
    const cookie = cookieOf(await register(t, 'a@x.io'))
    const before = await hashOf(t, 'a@x.io')
    const res = await main(env(t), ['nobody@x.io'])
    expect(res).toEqual({ code: 1, stderr: 'reset-password: failed: no user with that email' })
    expect(await hashOf(t, 'a@x.io')).toBe(before)
    expect((await me(t, cookie)).status).toBe(200)
  })

  it('no arguments, extra arguments or an unknown flag: exit 2 with a usage line', async () => {
    for (const argv of [[], ['a@x.io', 'b@x.io'], ['--force'], ['--password-stdin']]) {
      const res = await main({ DATABASE_URL: 'postgres://unused' }, argv)
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/^usage: reset-password <email>/)
    }
  })

  it('no DATABASE_URL: exit 2 with a usage line', async () => {
    const res = await main({}, ['a@x.io'])
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('DATABASE_URL is not set')
    expect(res.stderr).toContain('usage: reset-password <email>')
  })

  it('a database error is reported without the query or the password hash', async () => {
    const t = await withTestDb({ migrate: false })
    try {
      const res = await main({ DATABASE_URL: t.url }, ['a@x.io', '--password-stdin'], stdinOf(PW))
      expect(res.code).toBe(1)
      expect(res.stderr).toMatch(/^reset-password: failed: .*users/)
      expect(res.stderr).not.toMatch(/argon2|password_hash|update/i)
      expect(res.stderr).not.toContain(PW)
    } finally {
      await t.drop()
    }
  })

  it('unreachable database: exit 1 with one line', async () => {
    const res = await main({ DATABASE_URL: 'postgres://mock:mock@127.0.0.1:1/none' }, ['a@x.io'])
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/^reset-password: failed: \S/)
    expect(res.stderr).not.toContain('\n')
  })
})

describe('resetPassword', () => {
  it('throws ResetPasswordError for an unknown email', async () => {
    const t = await app()
    await expect(resetPassword(t.db, { email: 'x@x.io', password: PW })).rejects.toBeInstanceOf(
      ResetPasswordError,
    )
  })
})

describe('generatePassword', () => {
  it('is 20 characters from an alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword()
      expect(p).toMatch(/^[A-Za-z2-9]{20}$/)
      expect(p).not.toMatch(/[01OolI]/)
    }
  })
})
