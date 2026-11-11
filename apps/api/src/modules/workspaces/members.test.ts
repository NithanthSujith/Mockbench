import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceMembers } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'

type Role = 'owner' | 'editor' | 'viewer'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())

async function call(id: string, res: { status: number; body: unknown; text?: string }) {
  t.assertContract(id, res)
  return res
}

/** A workspace with a signed-in member of `role`; returns their membership id too. */
async function setup(role: Role) {
  const ws = await t.f.createWorkspace()
  const session = await t.session()
  const m = await t.f.createMember({ workspaceId: ws.id, userId: session.userId, role })
  return { ws, session, m }
}

const base = (wsId: string) => `/api/v1/workspaces/${wsId}/members`

describe('members.add  POST /workspaces/:id/members', () => {
  it('owner adds an existing user by email: 201 Member', async () => {
    const { ws, session } = await setup('owner')
    const u = await t.f.createUser({ email: 'newbie@example.test', name: 'Newbie' })
    const res = await call(
      'members.add',
      await t.as(session).post(base(ws.id)).send({ email: 'newbie@example.test', role: 'editor' }),
    )
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      userId: u.id,
      email: 'newbie@example.test',
      name: 'Newbie',
      role: 'editor',
    })
  })

  it('matches the email case-insensitively', async () => {
    const { ws, session } = await setup('owner')
    const u = await t.f.createUser({ email: 'MixedCase@Example.test' })
    const res = await call(
      'members.add',
      await t
        .as(session)
        .post(base(ws.id))
        .send({ email: 'mixedcase@EXAMPLE.test', role: 'viewer' }),
    )
    expect(res.status).toBe(201)
    expect((res.body as { userId: string }).userId).toBe(u.id)
    const again = await call(
      'members.add',
      await t
        .as(session)
        .post(base(ws.id))
        .send({ email: 'MIXEDCASE@example.test', role: 'viewer' }),
    )
    expect(again.status).toBe(409)
  })

  it('unknown email -> 404 user_not_found; existing member -> 409 already_member', async () => {
    const { ws, session } = await setup('owner')
    const nope = await call(
      'members.add',
      await t.as(session).post(base(ws.id)).send({ email: 'ghost@example.test', role: 'editor' }),
    )
    expect(nope.status).toBe(404)
    expect(nope.body).toMatchObject({ error: 'user_not_found' })

    const u = await t.f.createUser()
    await t.f.createMember({ workspaceId: ws.id, userId: u.id, role: 'viewer' })
    const dup = await call(
      'members.add',
      await t.as(session).post(base(ws.id)).send({ email: u.email, role: 'editor' }),
    )
    expect(dup.status).toBe(409)
    expect(dup.body).toMatchObject({ error: 'already_member' })
  })

  for (const role of ['editor', 'viewer'] as const) {
    it(`${role} gets 403`, async () => {
      const { ws, session } = await setup(role)
      const u = await t.f.createUser()
      const res = await call(
        'members.add',
        await t.as(session).post(base(ws.id)).send({ email: u.email, role: 'viewer' }),
      )
      expect(res.status).toBe(403)
    })
  }

  it('non-member gets 404', async () => {
    const ws = await t.f.createWorkspace()
    const s = await t.session()
    const u = await t.f.createUser()
    const res = await call(
      'members.add',
      await t.as(s).post(base(ws.id)).send({ email: u.email, role: 'viewer' }),
    )
    expect(res.status).toBe(404)
  })
})

describe('members.list  GET /workspaces/:id/members', () => {
  it('viewer sees every member with email, name, role, ordered by createdAt', async () => {
    const { ws, session } = await setup('viewer')
    const a = await t.f.createUser({ email: 'a-list@example.test', name: 'A' })
    const b = await t.f.createUser({ email: 'b-list@example.test', name: 'B' })
    await t.f.createMember({ workspaceId: ws.id, userId: a.id, role: 'owner' })
    await t.f.createMember({ workspaceId: ws.id, userId: b.id, role: 'editor' })
    const res = await call('members.list', await t.as(session).get(base(ws.id)))
    expect(res.status).toBe(200)
    const body = res.body as {
      items: { userId: string; email: string; name: string; role: string; createdAt: string }[]
      nextCursor: null
    }
    expect(body.nextCursor).toBeNull()
    expect(body.items).toHaveLength(3)
    expect(body.items[0]!.userId).toBe(session.userId)
    expect(body.items.slice(1).map((m) => m.email)).toEqual([
      'a-list@example.test',
      'b-list@example.test',
    ])
    expect(body.items.slice(1).map((m) => m.role)).toEqual(['owner', 'editor'])
    const times = body.items.map((m) => m.createdAt)
    expect([...times].sort()).toEqual(times)
  })

  it('non-member gets 404', async () => {
    const ws = await t.f.createWorkspace()
    const s = await t.session()
    expect((await call('members.list', await t.as(s).get(base(ws.id)))).status).toBe(404)
  })
})

describe('members.update  PATCH /workspaces/:id/members/:memberId', () => {
  it('owner changes a role: 200', async () => {
    const { ws, session } = await setup('owner')
    const m = await t.f.createMember({ workspaceId: ws.id, role: 'editor' })
    const res = await call(
      'members.update',
      await t
        .as(session)
        .patch(`${base(ws.id)}/${m.id}`)
        .send({ role: 'viewer' }),
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: m.id, role: 'viewer' })
  })

  it('demoting the only owner -> 409 last_owner, role unchanged; with two owners it succeeds', async () => {
    const { ws, session, m } = await setup('owner')
    const res = await call(
      'members.update',
      await t
        .as(session)
        .patch(`${base(ws.id)}/${m.id}`)
        .send({ role: 'viewer' }),
    )
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'last_owner' })
    const [row] = await t.db.select().from(workspaceMembers).where(eq(workspaceMembers.id, m.id))
    expect(row!.role).toBe('owner')

    await t.f.createMember({ workspaceId: ws.id, role: 'owner' })
    const ok = await call(
      'members.update',
      await t
        .as(session)
        .patch(`${base(ws.id)}/${m.id}`)
        .send({ role: 'viewer' }),
    )
    expect(ok.status).toBe(200)
  })

  for (const role of ['editor', 'viewer'] as const) {
    it(`${role} gets 403`, async () => {
      const { ws, session } = await setup(role)
      const m = await t.f.createMember({ workspaceId: ws.id, role: 'viewer' })
      const res = await call(
        'members.update',
        await t
          .as(session)
          .patch(`${base(ws.id)}/${m.id}`)
          .send({ role: 'owner' }),
      )
      expect(res.status).toBe(403)
    })
  }

  it('a memberId from another workspace -> 404 not_found; non-member -> 404', async () => {
    const { ws, session } = await setup('owner')
    const other = await t.f.createMember({ role: 'editor' })
    const res = await call(
      'members.update',
      await t
        .as(session)
        .patch(`${base(ws.id)}/${other.id}`)
        .send({ role: 'viewer' }),
    )
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'not_found' })

    const s2 = await t.session()
    const m = await t.f.createMember({ workspaceId: ws.id })
    const res2 = await call(
      'members.update',
      await t
        .as(s2)
        .patch(`${base(ws.id)}/${m.id}`)
        .send({ role: 'viewer' }),
    )
    expect(res2.status).toBe(404)
  })
})

describe('members.remove  DELETE /workspaces/:id/members/:memberId', () => {
  it('owner removes anyone except the last owner', async () => {
    const { ws, session, m } = await setup('owner')
    const e = await t.f.createMember({ workspaceId: ws.id, role: 'editor' })
    const ok = await call('members.remove', await t.as(session).delete(`${base(ws.id)}/${e.id}`))
    expect(ok.status).toBe(204)
    const last = await call('members.remove', await t.as(session).delete(`${base(ws.id)}/${m.id}`))
    expect(last.status).toBe(409)
    expect(last.body).toMatchObject({ error: 'last_owner' })
  })

  it('an owner can remove another owner, and then the remaining one is protected', async () => {
    const { ws, session } = await setup('owner')
    const o2 = await t.f.createMember({ workspaceId: ws.id, role: 'owner' })
    const ok = await call('members.remove', await t.as(session).delete(`${base(ws.id)}/${o2.id}`))
    expect(ok.status).toBe(204)
  })

  it('an editor removes their own membership (204) but not someone elses (403)', async () => {
    const { ws, session, m } = await setup('editor')
    const other = await t.f.createMember({ workspaceId: ws.id, role: 'viewer' })
    const no = await call(
      'members.remove',
      await t.as(session).delete(`${base(ws.id)}/${other.id}`),
    )
    expect(no.status).toBe(403)
    const yes = await call('members.remove', await t.as(session).delete(`${base(ws.id)}/${m.id}`))
    expect(yes.status).toBe(204)
    // They have lost access.
    expect((await call('members.list', await t.as(session).get(base(ws.id)))).status).toBe(404)
  })

  it('a viewer may leave too', async () => {
    const { ws, session, m } = await setup('viewer')
    const res = await call('members.remove', await t.as(session).delete(`${base(ws.id)}/${m.id}`))
    expect(res.status).toBe(204)
  })

  it('a memberId from another workspace -> 404; non-member -> 404', async () => {
    const { ws, session } = await setup('owner')
    const other = await t.f.createMember({ role: 'editor' })
    const res = await call(
      'members.remove',
      await t.as(session).delete(`${base(ws.id)}/${other.id}`),
    )
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'not_found' })
    const s2 = await t.session()
    const m = await t.f.createMember({ workspaceId: ws.id })
    expect(
      (await call('members.remove', await t.as(s2).delete(`${base(ws.id)}/${m.id}`))).status,
    ).toBe(404)
  })
})

describe('last-owner race', () => {
  it('two owners each demote/remove the other concurrently: exactly one succeeds (20 iterations)', async () => {
    for (let i = 0; i < 20; i++) {
      const ws = await t.f.createWorkspace()
      const s1 = await t.session()
      const s2 = await t.session()
      const m1 = await t.f.createMember({ workspaceId: ws.id, userId: s1.userId, role: 'owner' })
      const m2 = await t.f.createMember({ workspaceId: ws.id, userId: s2.userId, role: 'owner' })
      const demote = i % 2 === 0
      const [a, b] = await Promise.all([
        demote
          ? t
              .as(s1)
              .patch(`${base(ws.id)}/${m2.id}`)
              .send({ role: 'viewer' })
          : t.as(s1).delete(`${base(ws.id)}/${m2.id}`),
        demote
          ? t
              .as(s2)
              .patch(`${base(ws.id)}/${m1.id}`)
              .send({ role: 'viewer' })
          : t.as(s2).delete(`${base(ws.id)}/${m1.id}`),
      ])
      const statuses = [a.status, b.status].sort()
      // Success is 200 (demote) or 204 (remove); the loser sees 409 last_owner, or 404 if the winner
      // already removed the loser (who is no longer a member) - never two successes.
      const ok = demote ? 200 : 204
      expect(statuses.filter((s) => s === ok)).toHaveLength(1)
      const loser = a.status === ok ? b : a
      // The loser gets 409 last_owner when evaluated while still an owner; if the winner already
      // demoted/removed it, it is no longer allowed (403) or no longer a member (404).
      expect([403, 404, 409]).toContain(loser.status)
      if (loser.status === 409) expect(loser.body).toMatchObject({ error: 'last_owner' })
      const rows = await t.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, ws.id))
      expect(rows.filter((r) => r.role === 'owner')).toHaveLength(1)
    }
  })
})
