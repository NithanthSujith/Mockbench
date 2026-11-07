import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECK_VIOLATION, UNIQUE_VIOLATION, testDb, pgErrorCode } from './helper'
import type { TestDb } from './helper'

describe('users and sessions', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  it('users.email uniqueness is case-insensitive (A@x.io conflicts with a@x.io)', async () => {
    await t.make.user({ email: 'a@x.io' })
    expect(await pgErrorCode(t.make.user({ email: 'A@x.io' }))).toBe(UNIQUE_VIOLATION)
    expect(await t.make.user({ email: 'b@x.io' })).toBeTruthy()
  })

  it('users.email lookups match regardless of case', async () => {
    await t.make.user({ email: 'Mixed@Case.io' })
    const r = await t.one<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE email = 'mixed@case.io'`,
    )
    expect(Number(r.n)).toBe(1)
  })

  it('sessions.token_hash is unique', async () => {
    const userId = await t.make.user()
    const ins = () =>
      t.q(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'same-hash', now() + interval '1 day')`,
        [userId],
      )
    await ins()
    expect(await pgErrorCode(ins())).toBe(UNIQUE_VIOLATION)
  })

  it('deleting a user cascades to their sessions', async () => {
    const userId = await t.make.user()
    await t.q(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [userId, t.uniq('h')],
    )
    await t.q('DELETE FROM users WHERE id = $1', [userId])
    const r = await t.one<{ n: string }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [
      userId,
    ])
    expect(Number(r.n)).toBe(0)
  })

  it('sessions require a user that exists', async () => {
    const code = await pgErrorCode(
      t.q(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (uuid_v7(), $1, now())`, [
        t.uniq('h'),
      ]),
    )
    expect(code).toBe('23503')
  })

  it('sessions.last_used_at and created_at default to now', async () => {
    const userId = await t.make.user()
    const r = await t.one<{ ok: boolean }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')
       RETURNING (last_used_at <= now() AND created_at <= now()) AS ok`,
      [userId, t.uniq('h')],
    )
    expect(r.ok).toBe(true)
  })

  it('users.is_active defaults to true', async () => {
    const id = await t.make.user()
    const r = await t.one<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [id])
    expect(r.is_active).toBe(true)
  })

  it('rejects a null password hash', async () => {
    expect(
      await pgErrorCode(
        t.q(`INSERT INTO users (email, password_hash, name) VALUES ('n@x.io', NULL, 'n')`),
      ),
    ).toBe('23502')
    expect(CHECK_VIOLATION).toBe('23514')
  })
})
