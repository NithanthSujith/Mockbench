import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceMembers, workspaces } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import { baseSlug, candidateSlug, firstFreeSlug, freeSlugs, slugify } from './slug'

type Role = 'owner' | 'editor' | 'viewer'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())

/** A fresh workspace plus a user who is a member with `role` and a live session. */
async function memberOf(role: Role) {
  const ws = await t.f.createWorkspace()
  const session = await t.session()
  await t.f.createMember({ workspaceId: ws.id, userId: session.userId, role })
  return { ws, session }
}

/** Calls an endpoint and asserts the response against the frozen contract. */
async function call(id: string, res: { status: number; body: unknown; text?: string }) {
  t.assertContract(id, res)
  return res
}

describe('slug derivation', () => {
  it('slugifies names: lowercase, accents folded, separators collapsed', () => {
    expect(slugify('Alps Chemicals')).toBe('alps-chemicals')
    expect(slugify('  Café  Ünïcode!! ')).toBe('cafe-unicode')
    expect(slugify('日本語')).toBe('')
  })
  it('always yields a valid base slug (2-40 chars)', () => {
    expect(baseSlug('Alps Chemicals')).toBe('alps-chemicals')
    expect(baseSlug('日本語')).toBe('workspace')
    expect(baseSlug('X')).toBe('x-workspace')
    const long = baseSlug('a'.repeat(30) + ' ' + 'b'.repeat(30))
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })
  it('numbers collisions and never exceeds 40 characters', () => {
    expect(candidateSlug('acme', 1)).toBe('acme')
    expect(candidateSlug('acme', 2)).toBe('acme-2')
    const base = 'a'.repeat(40)
    const c = candidateSlug(base, 12)
    expect(c.length).toBe(40)
    expect(c.endsWith('-12')).toBe(true)
    expect(firstFreeSlug('acme', new Set(['acme', 'acme-2', 'acme-4']))).toBe('acme-3')
    expect(freeSlugs('acme', new Set(['acme', 'acme-3']), 3)).toEqual([
      'acme-2',
      'acme-4',
      'acme-5',
    ])
  })
})

describe('workspaces.create  POST /workspaces', () => {
  it('derives the slug, makes the caller owner, and numbers a duplicate name', async () => {
    const s = await t.session()
    const a = await call(
      'workspaces.create',
      await t.as(s).post('/api/v1/workspaces').send({ name: 'Alps Chemicals' }),
    )
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ name: 'Alps Chemicals', slug: 'alps-chemicals', role: 'owner' })

    const b = await call(
      'workspaces.create',
      await t.as(s).post('/api/v1/workspaces').send({ name: 'Alps Chemicals' }),
    )
    expect(b.status).toBe(201)
    expect((b.body as { slug: string }).slug).toBe('alps-chemicals-2')

    const c = await call(
      'workspaces.create',
      await t.as(s).post('/api/v1/workspaces').send({ name: 'Alps Chemicals' }),
    )
    expect((c.body as { slug: string }).slug).toBe('alps-chemicals-3')
  })

  it('stores the owner membership in the same transaction', async () => {
    const s = await t.session()
    const res = await t.as(s).post('/api/v1/workspaces').send({ name: 'Tx check' })
    const id = (res.body as { id: string }).id
    const rows = await t.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: s.userId, role: 'owner' })
  })

  it('an explicit slug that is taken is 409 slug_taken and creates no workspace and no membership', async () => {
    await t.f.createWorkspace({ slug: 'taken-slug' })
    const s = await t.session()
    const before = (await t.db.select().from(workspaces)).length
    const res = await call(
      'workspaces.create',
      await t.as(s).post('/api/v1/workspaces').send({ name: 'X', slug: 'taken-slug' }),
    )
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe('slug_taken')
    expect((await t.db.select().from(workspaces)).length).toBe(before)
    expect(
      await t.db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, s.userId)),
    ).toHaveLength(0)
  })

  it('uses an explicit free slug as given', async () => {
    const s = await t.session()
    const res = await call(
      'workspaces.create',
      await t.as(s).post('/api/v1/workspaces').send({ name: 'Anything', slug: 'my-own-slug' }),
    )
    expect(res.status).toBe(201)
    expect((res.body as { slug: string }).slug).toBe('my-own-slug')
  })

  it('rejects a malformed slug, an empty name and unknown keys with 422', async () => {
    const s = await t.session()
    for (const body of [
      { name: 'X', slug: 'Bad Slug' },
      { name: 'X', slug: 'a' },
      { name: '' },
      { name: 'X', extra: 1 },
    ]) {
      const res = await call(
        'workspaces.create',
        await t.as(s).post('/api/v1/workspaces').send(body),
      )
      expect(res.status, JSON.stringify(body)).toBe(422)
      expect((res.body as { error: string }).error).toBe('validation_failed')
    }
  })

  it('derives a valid slug for names with nothing sluggable', async () => {
    const s = await t.session()
    const res = await t.as(s).post('/api/v1/workspaces').send({ name: '日本語' })
    t.assertContract('workspaces.create', res)
    expect(res.status).toBe(201)
    expect((res.body as { slug: string }).slug).toMatch(/^workspace(-\d+)?$/)
  })

  it('parallel creates of the same name all succeed with distinct slugs', async () => {
    const sessions = await Promise.all(Array.from({ length: 16 }, () => t.session()))
    const results = await Promise.all(
      sessions.map((s) => t.as(s).post('/api/v1/workspaces').send({ name: 'Parallel Co' })),
    )
    expect(
      results.map((r) => `${r.status} ${(r.body as { error?: string }).error ?? ''}`.trim()),
    ).toEqual(Array(16).fill('201'))
    const slugs = results.map((r) => (r.body as { slug: string }).slug)
    expect(new Set(slugs).size).toBe(16)
    for (const s of slugs) expect(s).toMatch(/^parallel-co(-\d+)?$/)
  })

  it('needs a session', async () => {
    const res = await call(
      'workspaces.create',
      await t.as().post('/api/v1/workspaces').send({ name: 'No session' }),
    )
    expect(res.status).toBe(401)
  })
})

describe('workspaces.list  GET /workspaces', () => {
  it("returns only the caller's workspaces, with the caller's own role, ordered by name", async () => {
    const s = await t.session()
    const other = await t.session()
    const mine = [
      await t.f.createWorkspace({ name: 'bravo', slug: 'list-bravo' }),
      await t.f.createWorkspace({ name: 'Alpha', slug: 'list-alpha' }),
      await t.f.createWorkspace({ name: 'charlie', slug: 'list-charlie' }),
    ]
    await t.f.createMember({ workspaceId: mine[0]!.id, userId: s.userId, role: 'viewer' })
    await t.f.createMember({ workspaceId: mine[1]!.id, userId: s.userId, role: 'owner' })
    await t.f.createMember({ workspaceId: mine[2]!.id, userId: s.userId, role: 'editor' })
    const notMine = await t.f.createWorkspace({ name: 'Zulu', slug: 'list-zulu' })
    await t.f.createMember({ workspaceId: notMine.id, userId: other.userId, role: 'owner' })

    const res = await call('workspaces.list', await t.as(s).get('/api/v1/workspaces'))
    expect(res.status).toBe(200)
    const body = res.body as { items: { name: string; role: string }[]; nextCursor: null }
    expect(body.nextCursor).toBeNull()
    expect(body.items.map((w) => [w.name, w.role])).toEqual([
      ['Alpha', 'owner'],
      ['bravo', 'viewer'],
      ['charlie', 'editor'],
    ])
  })

  it('a user in no workspace gets an empty page', async () => {
    const s = await t.session()
    const res = await call('workspaces.list', await t.as(s).get('/api/v1/workspaces'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], nextCursor: null })
  })

  it('needs a session', async () => {
    const res = await call('workspaces.list', await t.as().get('/api/v1/workspaces'))
    expect(res.status).toBe(401)
  })
})

describe('workspaces.get  GET /workspaces/:workspaceId  (viewer+)', () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    it(`${role} gets 200 with their own role`, async () => {
      const { ws, session } = await memberOf(role)
      const res = await call(
        'workspaces.get',
        await t.as(session).get(`/api/v1/workspaces/${ws.id}`),
      )
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: ws.id, slug: ws.slug, role })
    })
  }
  it('a non-member gets 404 not_found, the same as a workspace that does not exist', async () => {
    const { ws } = await memberOf('owner')
    const stranger = await t.session()
    const a = await call('workspaces.get', await t.as(stranger).get(`/api/v1/workspaces/${ws.id}`))
    const b = await call(
      'workspaces.get',
      await t.as(stranger).get('/api/v1/workspaces/018f0000-0000-7000-8000-000000000000'),
    )
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
    expect(a.body).toEqual(b.body)
  })
  it('needs a session', async () => {
    const { ws } = await memberOf('owner')
    const res = await call('workspaces.get', await t.as().get(`/api/v1/workspaces/${ws.id}`))
    expect(res.status).toBe(401)
  })
})

describe('workspaces.update  PATCH /workspaces/:workspaceId  (owner)', () => {
  it('owner renames: 200, new name, slug unchanged, updatedAt advances', async () => {
    const { ws, session } = await memberOf('owner')
    const before = await t.as(session).get(`/api/v1/workspaces/${ws.id}`)
    const res = await call(
      'workspaces.update',
      await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send({ name: 'Renamed' }),
    )
    expect(res.status).toBe(200)
    const body = res.body as { name: string; slug: string; role: string; updatedAt: string }
    expect(body).toMatchObject({ name: 'Renamed', slug: ws.slug, role: 'owner' })
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(
      Date.parse((before.body as { updatedAt: string }).updatedAt),
    )
  })

  for (const role of ['editor', 'viewer'] as const) {
    it(`${role} gets 403 forbidden and nothing changes`, async () => {
      const { ws, session } = await memberOf(role)
      const res = await call(
        'workspaces.update',
        await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send({ name: 'Nope' }),
      )
      expect(res.status).toBe(403)
      const [row] = await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))
      expect(row!.name).toBe(ws.name)
    })
  }

  it('a non-member gets 404 and an anonymous caller 401', async () => {
    const { ws } = await memberOf('owner')
    const stranger = await t.session()
    const a = await call(
      'workspaces.update',
      await t.as(stranger).patch(`/api/v1/workspaces/${ws.id}`).send({ name: 'x' }),
    )
    expect(a.status).toBe(404)
    const b = await call(
      'workspaces.update',
      await t.as().patch(`/api/v1/workspaces/${ws.id}`).send({ name: 'x' }),
    )
    expect(b.status).toBe(401)
  })

  it('the slug is read-only: 422 with issue code read_only', async () => {
    const { ws, session } = await memberOf('owner')
    const res = await call(
      'workspaces.update',
      await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send({ slug: 'x-new' }),
    )
    expect(res.status).toBe(422)
    const body = res.body as { error: string; details: { code: string; path: unknown[] }[] }
    expect(body.error).toBe('validation_failed')
    expect(body.details.some((d) => d.code === 'read_only' && d.path.includes('slug'))).toBe(true)
    const [row] = await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))
    expect(row!.slug).toBe(ws.slug)
  })

  it('{} is a 200 no-op and does not move updatedAt; so is a rename to the same name', async () => {
    const { ws, session } = await memberOf('owner')
    const before = (await t.as(session).get(`/api/v1/workspaces/${ws.id}`)).body as {
      updatedAt: string
    }
    const empty = await call(
      'workspaces.update',
      await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send({}),
    )
    expect(empty.status).toBe(200)
    expect((empty.body as { updatedAt: string }).updatedAt).toBe(before.updatedAt)
    const same = await call(
      'workspaces.update',
      await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send({ name: ws.name }),
    )
    expect((same.body as { updatedAt: string }).updatedAt).toBe(before.updatedAt)
  })

  it('rejects name:null, an empty name and unknown keys with 422', async () => {
    const { ws, session } = await memberOf('owner')
    for (const body of [{ name: null }, { name: '' }, { bogus: true }]) {
      const res = await call(
        'workspaces.update',
        await t.as(session).patch(`/api/v1/workspaces/${ws.id}`).send(body),
      )
      expect(res.status, JSON.stringify(body)).toBe(422)
    }
  })
})

describe('workspaces.delete  DELETE /workspaces/:workspaceId  (owner)', () => {
  it('an empty workspace is deleted: 204 and its memberships go with it', async () => {
    const { ws, session } = await memberOf('owner')
    await t.f.createMember({ workspaceId: ws.id, role: 'viewer' })
    const res = await call(
      'workspaces.delete',
      await t.as(session).delete(`/api/v1/workspaces/${ws.id}`),
    )
    expect(res.status).toBe(204)
    expect(await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))).toHaveLength(0)
    expect(
      await t.db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws.id)),
    ).toHaveLength(0)
  })

  it('a workspace with a project is 409 workspace_not_empty and is kept', async () => {
    const { ws, session } = await memberOf('owner')
    await t.f.createProject({ workspaceId: ws.id })
    const res = await call(
      'workspaces.delete',
      await t.as(session).delete(`/api/v1/workspaces/${ws.id}`),
    )
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe('workspace_not_empty')
    expect(await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))).toHaveLength(1)
    expect(
      await t.db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws.id)),
    ).toHaveLength(1)
  })

  for (const role of ['editor', 'viewer'] as const) {
    it(`${role} gets 403 and the workspace stays`, async () => {
      const { ws, session } = await memberOf(role)
      const res = await call(
        'workspaces.delete',
        await t.as(session).delete(`/api/v1/workspaces/${ws.id}`),
      )
      expect(res.status).toBe(403)
      expect(await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))).toHaveLength(1)
    })
  }

  it('a non-member gets 404 and an anonymous caller 401', async () => {
    const { ws } = await memberOf('owner')
    const stranger = await t.session()
    const a = await call(
      'workspaces.delete',
      await t.as(stranger).delete(`/api/v1/workspaces/${ws.id}`),
    )
    expect(a.status).toBe(404)
    const b = await call('workspaces.delete', await t.as().delete(`/api/v1/workspaces/${ws.id}`))
    expect(b.status).toBe(401)
    expect(await t.db.select().from(workspaces).where(eq(workspaces.id, ws.id))).toHaveLength(1)
  })
})

describe('the workspaces module binds only its own endpoints', () => {
  it('members.* stays unimplemented until WS-02', async () => {
    const { ws, session } = await memberOf('owner')
    const res = await t.as(session).get(`/api/v1/workspaces/${ws.id}/members`)
    expect(res.status).toBe(501)
  })
})
